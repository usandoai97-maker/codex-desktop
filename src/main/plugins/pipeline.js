'use strict';

/** Executa plugins multi-agente, passando a saída de cada etapa para a próxima. */

const auth = require('../codexAuth');
const { streamRound } = require('../ipc/codexApi');
const { getSettings } = require('../settings');
const tools = require('../tools');

const FALLBACK_MODELS = ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.5'];

function emit(event, type, data) {
  event.sender.send('codex-api:stream-chunk', { type, ...data });
}

async function runPipeline(plugin, task, event) {
  if (!plugin?.pipeline?.length) return { error: true, message: 'Plugin não tem pipeline.' };

  const tokenResult = await auth.getValidAccessToken();
  if (!tokenResult) return { error: true, status: 401, message: 'Não autenticado.' };

  const outputs = [];
  let context = '';
  const model = getSettings().pipelineModel || FALLBACK_MODELS[0];
  const effort = getSettings().reasoningEffort || 'high';

  // Descoberta determinística do Studio: o modelo não precisa perder turnos nisso.
  let studioHint = '';
  try {
    const discovered = await tools.invoke('mcp_roblox_studio__list_roblox_studios', {});
    if (discovered.ok) {
      const text = discovered.result?.content?.[0]?.text;
      const data = text ? JSON.parse(text) : null;
      const studio = data?.studios?.[0];
      if (studio) {
        studioHint = `\n\nStudio conectado: id=${studio.id}, nome=${studio.name}. `
          + 'Use ESSE studio_id em todas as ferramentas MCP e datamodel_type="Edit" para criar objetos.';
        emit(event, 'plugin-stage', { plugin: plugin.id, name: 'Studio conectado', key: 'studio' });
      }
    }
  } catch { /* segue sem hint se o MCP não estiver conectado */ }

  for (const stage of plugin.pipeline) {
    emit(event, 'plugin-stage', { plugin: plugin.id, name: stage.name, key: stage.key });
    emit(event, 'text', { delta: `\n\n── ${stage.name} ──\n` });

    const input = [];
    input.push({
      role: 'system',
      content: 'EXECUTE com ferramentas. CRIE de fato no Studio — não apenas descreva o plano. '
        + 'Nunca responda só com texto ou saudação. '
        + stage.prompt
        + studioHint
        + (context ? `\n\nTrabalho da etapa anterior (use como referência):\n${context.slice(0, 12000)}` : ''),
    });
    input.push({ role: 'user', content: task });

    let result;
    try {
      result = await streamRound({
        input,
        model,
        tokenResult,
        event,
        withTools: true,
        effort,
        toolAllow: stage.toolAllow,
      });
    } catch (err) {
      return { error: true, message: `Falha na etapa ${stage.name}: ${err.message}` };
    }

    if (result.error) return { error: true, status: result.status, message: result.message };
    outputs.push({ stage: stage.key, name: stage.name, text: result.text, tokens: result.tokens });
    context = result.text || context;
  }

  emit(event, 'done', {});
  return { error: false, outputs };
}

module.exports = { runPipeline };
