'use strict';

const { ipcMain } = require('electron');
const auth = require('../codexAuth');
const tools = require('../tools');
const { getSettings } = require('../settings');
const usage = require('../usage');
const history = require('../history');

const API_URL = 'https://chatgpt.com/backend-api/codex/responses';
const MODELS_URL = 'https://chatgpt.com/backend-api/codex/models';
const CLIENT_VERSION = process.env.CODEX_CLIENT_VERSION || '0.164.0';
const FALLBACK_MODELS = ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.5'];
const ENABLE_TOOLS = process.env.CODEX_ENABLE_TOOLS !== '0';

const CHAT_PROMPT = 'Você é um assistente conversacional. Responda em português de forma clara e objetiva. Modo CHAT: não use ferramentas nem acesse a máquina.';
const AGENT_PROMPT = 'Você é um agente local no Windows com acesso à máquina do usuário. Use as ferramentas disponíveis sempre que precisar: arquivos, pastas, PowerShell/cmd, processos, área de transferência, extração de áudio/vídeo e ferramentas MCP conectadas. Para tarefas do sistema prefira run_powershell. Respeite as confirmações de segurança. Responda em português e explique o que fez.';

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

async function streamRound({ input, model, tokenResult, event, withTools, effort, withReasoning = true }) {
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

  const body = {
    model,
    instructions,
    input: normalizedInput,
    stream: true,
    store: false,
  };
  if (withTools && ENABLE_TOOLS) body.tools = tools.definitions();
  if (withReasoning && effort && effort !== 'auto') {
    body.reasoning = { effort, summary: 'auto' };
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
      return streamRound({ input, model, tokenResult, event, withTools: false, effort, withReasoning });
    }
    if (response.status === 400 && withReasoning && body.reasoning && /reasoning|effort/i.test(text)) {
      emit(event, 'notice', { message: `Backend não aceitou o esforço "${effort}"; repetindo sem reasoning.` });
      return streamRound({ input, model, tokenResult, event, withTools, effort, withReasoning: false });
    }
    return { error: true, status: response.status, message: text.slice(0, 1200) };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map();
  let buffer = '';
  let text = '';

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

      if (ev === 'response.output_text.delta' || ev === 'response.text.delta') {
        const delta = data.delta || '';
        text += delta;
        emit(event, 'text', { delta });
      } else if (ev === 'response.function_call_arguments.delta') {
        const callId = data.call_id || data.item_id || 'call';
        const prev = calls.get(callId) || { name: data.name || '', args: '' };
        prev.args += data.delta || '';
        if (data.name) prev.name = data.name;
        calls.set(callId, prev);
      } else if (ev === 'response.function_call_arguments.done') {
        const callId = data.call_id || data.item_id || 'call';
        const prev = calls.get(callId) || { name: data.name || '', args: '' };
        calls.set(callId, {
          name: data.name || prev.name,
          args: data.arguments || prev.args,
          done: true,
        });
      } else if (ev === 'response.output_item.done' && data.item?.type === 'function_call') {
        const item = data.item;
        calls.set(item.call_id || 'call', {
          name: item.name,
          args: item.arguments || '',
          done: true,
        });
      }

      emit(event, 'sse', { data, raw });
    }
  }

  return { error: false, text, calls: Array.from(calls.entries()).map(([call_id, c]) => ({
    call_id, name: c.name, arguments: c.args,
  })) };
}

/* ---------------- Registro de handlers ---------------- */

function register() {
  ipcMain.handle('codex-api:list-models', listModels);

  ipcMain.handle('codex-api:stream-request', async (event, payload = {}) => {
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
    input.unshift({ role: 'system', content: isCodex ? AGENT_PROMPT : CHAT_PROMPT });

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

    for (let round = 0; round <= maxRounds; round++) {
      let result;
      try {
        result = await streamRound({ input, model, tokenResult, event, withTools: isCodex, effort });
      } catch (err) {
        return finishChat({ error: true, status: 0, message: `Falha de rede: ${err.message}` });
      }

      if (result.error) return finishChat({ error: true, status: result.status, message: result.message });
      totalText += result.text || '';

      if (!result.calls?.length || round === maxRounds) {
        emit(event, 'done', {});
        return finishChat({ error: false, status: 200, rounds: round + 1, text: totalText });
      }

      // Executa cada ferramenta e devolve o resultado ao modelo.
      for (const call of result.calls) {
        let args = {};
        try { args = JSON.parse(call.arguments || '{}'); } catch { /* args vazios */ }
        emit(event, 'tool-call', { name: call.name, args, call_id: call.call_id });
        const outcome = await tools.invoke(call.name, args);
        emit(event, 'tool-result', { name: call.name, call_id: call.call_id, ok: outcome.ok,
          summary: clipForEvent(outcome) });
        input.push({
          type: 'function_call',
          call_id: call.call_id,
          name: call.name,
          arguments: call.arguments || '{}',
        });
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(outcome),
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

module.exports = { register, listModels, streamRound };
