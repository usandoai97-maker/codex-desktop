'use strict';

/** Teste do registro de plugins e do pipeline multi-agente. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-plugins-'));
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') {
    return {
      app: { getPath: () => TMP },
      safeStorage: { isEncryptionAvailable: () => false },
      ipcMain: { handle: () => {} },
      shell: { openExternal: async () => {} },
    };
  }
  return originalLoad.apply(this, arguments);
};

// Token falso para o pipeline
fs.writeFileSync(path.join(TMP, 'codex-auth.json'), Buffer.from(JSON.stringify({
  access_token: 'tok', account_id: 'acc', expires_at: Math.floor(Date.now() / 1000) + 3600,
})).toString('base64'));

// Stub do streamRound para não chamar a API
const apiPath = require.resolve('../src/main/ipc/codexApi');
const stageTools = [];
require.cache[apiPath] = {
  id: apiPath, filename: apiPath, loaded: true,
  exports: {
    streamRound: async ({ toolAllow }) => {
      stageTools.push(toolAllow ? toolAllow.source : null);
      return { error: false, text: 'resultado etapa ' + stageTools.length, tokens: 12 };
    },
  },
};

const plugins = require('../src/main/plugins');
const { runPipeline } = require('../src/main/plugins/pipeline');

(async () => {
  const list = plugins.list();
  assert.equal(list.length, 8);
  const gui = plugins.get('codex_gui');
  assert.equal(gui.pipeline.length, 2);
  assert.equal(gui.pipeline[0].name, 'Designer');
  assert.equal(gui.pipeline[1].name, 'Developer');
  console.log('✓ 8 plugins registrados, Codex GUI com 2 agentes');

  assert.ok(plugins.systemPrompt(plugins.get('code_reviewer')).includes('revisor'));
  assert.ok(plugins.systemPrompt(gui).includes('Designer → Developer'));
  console.log('✓ prompts de plugin gerados');

  const events = [];
  const event = { sender: { send: (_n, data) => events.push(data) } };
  const result = await runPipeline(gui, 'crie uma界面 de jogo', event);
  assert.equal(result.error, false);
  assert.equal(result.outputs.length, 2);
  assert.equal(result.outputs[0].name, 'Designer');
  assert.equal(result.outputs[1].name, 'Developer');
  assert.ok(events.some((e) => e.type === 'plugin-stage'));
  assert.ok(stageTools[0].includes('generate_'));
  assert.ok(stageTools[1].includes('execute_luau'));
  console.log('✓ pipeline roda 2 agentes com ferramentas diferentes');

  console.log('\nTODOS OS TESTES PASSARAM');
  process.exit(0);
})().catch((err) => { console.error('FALHA:', err); process.exit(1); });
