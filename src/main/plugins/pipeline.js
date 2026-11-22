'use strict';

/** Executa plugins multi-agente, passando a saída de cada etapa para a próxima. */

const auth = require('../codexAuth');
const { streamRound } = require('../ipc/codexApi');
const { getSettings } = require('../settings');

const FALLBACK_MODELS = ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.5'];

function emit(event, type, data) {
  event.sender.send('codex-api:stream-chunk', { type, ...data });
}

async function runPipeline(plugin, task, event) {
  if (!plugin?.pipeline?.length) return { error: true, message: 'Plugin não tem pipeline.' };

  const tokenResult = await auth.getValidAccessToken();
  if (!tokenResult) return { error: true, status: 401, message: 'Não autenticado.' };

  const outputs = [];
  let context = '';
  const model = FALLBACK_MODELS[0];
  const effort = getSettings().reasoningEffort || 'high';

  for (const stage of plugin.pipeline) {
    emit(event, 'plugin-stage', { plugin: plugin.id, name: stage.name, key: stage.key });
    emit(event, 'text', { delta: `\n\n── ${stage.name} ──\n` });

    const input = [];
    if (context) {
      input.push({ role: 'system', content: `Trabalho da etapa anterior (use como referência):\n${context.slice(0, 12000)}` });
    }
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
