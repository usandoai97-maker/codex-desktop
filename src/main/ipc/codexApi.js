'use strict';

const { ipcMain } = require('electron');
const auth = require('../codexAuth');
const tools = require('../tools');
const { getSettings } = require('../settings');
const usage = require('../usage');
const history = require('../history');
const fiveHour = require('../fiveHour');
const plugins = require('../plugins');

const API_URL = 'https://chatgpt.com/backend-api/codex/responses';
const MODELS_URL = 'https://chatgpt.com/backend-api/codex/models';
const CLIENT_VERSION = process.env.CODEX_CLIENT_VERSION || '0.164.0';
const FALLBACK_MODELS = ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.5'];
const ENABLE_TOOLS = process.env.CODEX_ENABLE_TOOLS !== '0';

let reuseGloballyDisabled = false;

const CHAT_PROMPT = 'Você é um assistente conversacional. Responda em português de forma clara e objetiva. Modo CHAT: não use ferramentas nem acesse a máquina.';
// Prompt enxuto (mesmas regras, menos tokens por requisição/rodada).
const AGENT_PROMPT = 'Agente local Windows. Ao receber uma tarefa, EXECUTE com ferramentas — não responda só com saudação ou explicação. Prefira run_powershell. Responda em português. REGRA CRÍTICA: chame list_roblox_studios NO MÁXIMO UMA VEZ por conversa; se já tem o studio_id, USE-O. Nunca repita list_roblox_studios/list_roblox_skills/get_roblox_skill. Nunca repita uma chamada com os mesmos argumentos. Rework: search_game_tree → Destroy antigos → criar → verificar.';

function emit(event, type, data) {
  event.sender.send('codex-api:stream-chunk', { type, ...data });
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60} min`;
}

function rateLimitMessage(info) {
  const parts = [info.message || 'Limite de uso da conta ChatGPT atingido.'];
  if (info.resetSeconds) {
    parts.push(`Renova em ~${formatDuration(info.resetSeconds)}.`);
  } else if (info.primary?.resetAfterSeconds) {
    parts.push(`Limite de 5h renova em ~${formatDuration(info.primary.resetAfterSeconds)}.`);
  } else if (info.secondary?.resetAfterSeconds) {
    parts.push(`Limite semanal renova em ~${formatDuration(info.secondary.resetAfterSeconds)}.`);
  }
  parts.push('Troque de modelo no seletor ou abra o painel Uso para detalhes.');
  return parts.join(' ');
}

/* ---------------- Catálogo de modelos ---------------- */

async function listModels() {
  if (auth.DEMO) return { error: false, models: FALLBACK_MODELS, demo: true };

  const tokenResult = await auth.getValidAccessToken();
  if (!tokenResult) {
    return { error: true, status: 401, message: 'Não autenticado.', models: FALLBACK_MODELS };
  }

  try {
    const url = `${MODELS_URL}?${new URLSearchParams({ client_version: CLIENT_VERSION })}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tokenResult.access_token}`,
        'Chatgpt-Account-Id': tokenResult.account_id,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return {
        error: true, status: response.status,
        message: (await response.text()).slice(0, 400), models: FALLBACK_MODELS,
      };
    }

    const data = await response.json();
    const models = (data.models || [])
      .filter((m) => m.slug && m.visibility !== 'hide')
      .map((m) => m.slug);
    return { error: false, models: models.length ? models : FALLBACK_MODELS };
  } catch (err) {
    return { error: true, message: err.message, models: FALLBACK_MODELS };
  }
}

/* ---------------- Uma rodada de stream ---------------- */

async function streamRound({ input, model, tokenResult, event, withTools, effort, withReasoning = true,
  previousResponseId = null, store = false, reuse = false, toolAllow = null }) {
  let instructions = '';
  const normalizedInput = [];
  for (const item of input || []) {
    if (item.role === 'system') {
      instructions += (instructions ? '\n' : '') + item.content;
    } else if (item.type === 'function_call' || item.type === 'function_call_output') {
      normalizedInput.push(item);
    } else {
      normalizedInput.push({ type: 'message', role: item.role, content: item.content });
    }
  }

  const body = { model, input: normalizedInput, stream: true, store };

  if (previousResponseId && reuse) {
    // Rodada de ferramenta: o backend já tem prompt/ferramentas/histórico da resposta anterior.
    body.previous_response_id = previousResponseId;
  } else {
    body.instructions = instructions;
    if (withTools && ENABLE_TOOLS) {
      const defs = tools.definitions();
      body.tools = toolAllow ? defs.filter((d) => toolAllow.test(d.name)) : defs;
    }
    if (withReasoning && effort && effort !== 'auto') body.reasoning = { effort, summary: 'auto' };
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenResult.access_token}`,
      'Chatgpt-Account-Id': tokenResult.account_id,
    },
    body: JSON.stringify(body),
  });

  usage.ingestHeaders(response.headers);

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 429 || /usage limit|rate limit|at capacity/i.test(text)) {
      const info = usage.rateLimitInfo(response, text);
      emit(event, 'rate-limit', info);
      return { error: true, status: 429, message: rateLimitMessage(info), rateLimit: info };
    }
    // Se o backend não aceitar o campo tools, tenta sem ele.
    if (response.status === 400 && withTools && /tool/i.test(text)) {
      emit(event, 'notice', { message: 'Backend não aceitou ferramentas; repetindo sem tools.' });
      return streamRound({ input, model, tokenResult, event, withTools: false, effort, withReasoning,
        previousResponseId, store, reuse });
    }
    if (response.status === 400 && withReasoning && body.reasoning && /reasoning|effort/i.test(text)) {
      emit(event, 'notice', { message: `Backend não aceitou o esforço "${effort}"; repetindo sem reasoning.` });
      return streamRound({ input, model, tokenResult, event, withTools, effort, withReasoning: false,
        previousResponseId, store, reuse });
    }
    if (reuse && response.status === 400 && /previous_response_id|store|response not found/i.test(text)) {
      emit(event, 'notice', { message: 'Backend não suporta reuso de resposta; usando modo clássico.' });
      const classic = await streamRound({ input, model, tokenResult, event, withTools, effort, withReasoning });
      return { ...classic, fallback: true };
    }
    return { error: true, status: response.status, message: text.slice(0, 1200) };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map();
  const nameById = new Map();
  let buffer = '';
  let text = '';
  let usageTokens = 0;
  let responseId = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;

      let data;
      try { data = JSON.parse(raw); } catch {
        emit(event, 'raw', { raw });
        continue;
      }

      const ev = data.type || '';

      const captureItem = (item) => {
        if (!item || item.type !== 'function_call') return;
        const ids = [item.call_id, item.id, item.item_id].filter(Boolean);
        for (const id of ids) if (item.name) nameById.set(id, item.name);
        const callId = item.call_id || item.id || item.item_id;
        if (!callId) return;
        const prev = calls.get(callId) || { name: '', args: '' };
        prev.name = item.name || prev.name;
        if (item.arguments) prev.args = item.arguments;
        calls.set(callId, { ...prev, done: true });
      };

      if (ev === 'response.completed' || ev === 'response.usage') {
        if (data.response?.id) responseId = data.response.id;
        const u = data.response?.usage || data.usage;
        if (u) {
          const total = u.total_tokens
            ?? ((Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0));
          if (total > 0) usageTokens += total;
        }
      }

      if (ev === 'response.output_text.delta' || ev === 'response.text.delta') {
        const delta = data.delta || '';
        text += delta;
        emit(event, 'text', { delta });
      } else if (ev === 'response.output_item.added' || ev === 'response.output_item.done') {
        captureItem(data.item);
      } else if (ev === 'response.function_call_arguments.delta') {
        const callId = data.call_id || data.item_id || 'call';
        if (data.name) nameById.set(callId, data.name);
        const prev = calls.get(callId) || { name: nameById.get(callId) || '', args: '' };
        prev.args += data.delta || '';
        if (data.name) prev.name = data.name;
        calls.set(callId, prev);
      } else if (ev === 'response.function_call_arguments.done') {
        const callId = data.call_id || data.item_id || 'call';
        if (data.name) nameById.set(callId, data.name);
        const prev = calls.get(callId) || { name: nameById.get(callId) || '', args: '' };
        calls.set(callId, {
          name: data.name || prev.name || nameById.get(callId) || '',
          args: data.arguments || prev.args,
          done: true,
        });
      }

      emit(event, 'sse', { data, raw });
    }
  }

  // Nome nunca pode chegar vazio ao backend (o Responses API rejeita string vazia).
  const finalCalls = Array.from(calls.entries()).map(([call_id, c]) => ({
    call_id: call_id || 'call',
    name: c.name || nameById.get(call_id) || 'unknown_tool',
    arguments: c.args || '{}',
  }));
  return { error: false, text, calls: finalCalls, tokens: usageTokens, responseId };
}

/* ---------------- Registro de handlers ---------------- */

function register() {
  ipcMain.handle('codex-api:list-models', listModels);

  ipcMain.handle('codex-api:stream-request', async (event, payload = {}) => {
    // Contador local de 5h: alimentado por Chat e Codex
    fiveHour.recordMessage();

    // Demo: resposta falsa + demonstração de ferramenta
    if (auth.DEMO) {
      const userText = (payload.input || []).filter((m) => m.role === 'user').map((m) => m.content).join(' ');
      const mode = payload.mode || getSettings().mode || 'chat';
      const texto = mode === 'codex'
        ? `Modo CODEX (demo): recebi "${userText}".\n\nO agente tem ${tools.summary().length} ferramentas disponíveis (PowerShell, arquivos, pastas, processos, extração e MCP). Faça login real para executá-las.`
        : `Modo CHAT (demo): recebi "${userText}".\n\nModo conversa sem acesso à máquina. Mude para CODEX para usar ferramentas.`;
      history.add({
        type: 'chat', name: 'Mensagem (demo)', mode, model: payload.model || FALLBACK_MODELS[0],
        preview: userText.slice(0, 200), ok: true, status: 'done', ms: 0,
      });
      for (const char of texto) emit(event, 'text', { delta: char });
      emit(event, 'done', {});
      return { error: false, status: 200, demo: true };
    }

    const startedAt = Date.now();
    let entryId = null;

    const tokenResult = await auth.getValidAccessToken();
    if (!tokenResult) {
      history.add({ type: 'chat', name: 'Mensagem', status: 'error', ok: false,
        preview: 'Não autenticado', ms: Date.now() - startedAt });
      return { error: true, status: 401, message: 'Não autenticado. Faça login com o ChatGPT primeiro.' };
    }

    const settings = getSettings();
    const mode = payload.mode || settings.mode || 'chat';
    const isCodex = mode === 'codex';
    const effort = payload.reasoningEffort || settings.reasoningEffort || 'high';
    const model = payload.model || FALLBACK_MODELS[0];
    const maxRounds = isCodex ? Math.min(Number(settings.maxToolRounds) || 5, 10) : 0;

    // O prompt do sistema é controlado pelo modo, não pela UI.
    const input = (payload.input || [])
      .filter((item) => item.role !== 'system')
      .map((item) => ({ ...item }));
    const pluginPrompt = plugins.systemPrompt(plugins.get(settings.activePlugin));
    input.unshift({
      role: 'system',
      content: (isCodex ? AGENT_PROMPT : CHAT_PROMPT) + (pluginPrompt ? '\n\n' + pluginPrompt : ''),
    });

    const preview = (payload.input || [])
      .filter((item) => item.role === 'user')
      .map((item) => item.content).join(' ').slice(0, 200);
    entryId = history.add({
      type: 'chat', name: 'Mensagem', mode, model, effort,
      preview, status: 'running', ok: null,
    });

    const finishChat = (outcome) => {
      if (entryId) {
        history.update(entryId, {
          ok: !outcome.error,
          status: outcome.error ? 'error' : 'done',
          preview: outcome.error ? String(outcome.message).slice(0, 200)
            : String(outcome.text || totalText || '(sem texto)').slice(0, 200),
          ms: Date.now() - startedAt,
          rounds: outcome.rounds,
        });
      }
      return outcome;
    };

    let totalText = '';
    const seenCalls = new Map();
    let previousResponseId = null;
    let followupItems = [];

    for (let round = 0; round <= maxRounds; round++) {
      const reuse = round > 0 && !!previousResponseId
        && settings.reuseResponses !== false && !reuseGloballyDisabled;
      let result;
      try {
        result = await streamRound({
          input: reuse ? followupItems : input,
          model, tokenResult, event, withTools: isCodex, effort,
          previousResponseId: reuse ? previousResponseId : null,
          store: reuse, reuse,
        });
      } catch (err) {
        return finishChat({ error: true, status: 0, message: `Falha de rede: ${err.message}` });
      }

      if (result.error) return finishChat({ error: true, status: result.status, message: result.message });
      if (result.fallback) { previousResponseId = null; reuseGloballyDisabled = true; }
      else if (result.responseId) previousResponseId = result.responseId;
      if (result.tokens) fiveHour.addTokens(result.tokens);
      totalText += result.text || '';

      if (!result.calls?.length || round === maxRounds) {
        emit(event, 'done', {});
        return finishChat({ error: false, status: 200, rounds: round + 1, text: totalText });
      }

      // Executa cada ferramenta e devolve só os novos itens na próxima rodada.
      followupItems = [];
      for (const call of result.calls) {
        let args = {};
        try { args = JSON.parse(call.arguments || '{}'); } catch { /* args vazios */ }
        const toolName = call.name || 'unknown_tool';
        const signature = toolName + ':' + JSON.stringify(args);
        const repeated = seenCalls.has(signature);
        let outcome;
        if (repeated) {
          outcome = seenCalls.get(signature);
          emit(event, 'notice', { message: `Chamada repetida ignorada: ${toolName}. Use o resultado anterior e avance.` });
        } else {
          emit(event, 'tool-call', { name: toolName, args, call_id: call.call_id });
          outcome = await tools.invoke(toolName, args);
          seenCalls.set(signature, outcome);
        }
        emit(event, 'tool-result', { name: toolName, call_id: call.call_id, ok: outcome.ok,
          summary: repeated ? 'Resultado reaproveitado — NÃO repita esta chamada.' : clipForEvent(outcome) });
        if (['mcp_connect', 'mcp_disconnect'].includes(toolName)) {
          emit(event, 'mcp-changed', { name: toolName, ok: outcome.ok });
        }
        followupItems.push({
          type: 'function_call',
          call_id: call.call_id || 'call',
          name: toolName,
          arguments: call.arguments || '{}',
        });
        followupItems.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: compactOutcome(outcome),
        });
      }
    }

    emit(event, 'done', {});
    return finishChat({ error: false, status: 200, rounds: maxRounds + 1, text: totalText });
  });
}

function clipForEvent(outcome) {
  const s = outcome.ok ? JSON.stringify(outcome.result) : String(outcome.error);
  return s.length > 600 ? s.slice(0, 600) + '…' : s;
}

/** Limita o retorno das ferramentas antes de voltar ao modelo (evita estourar contexto). */
function compactOutcome(outcome) {
  const max = 20000;
  const s = JSON.stringify(outcome);
  return s.length > max ? s.slice(0, max) + '"}]}…[TRUNCADO]' : s;
}

module.exports = { register, listModels, streamRound };
