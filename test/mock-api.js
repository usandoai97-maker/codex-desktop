'use strict';

/** Teste do proxy IPC -> backend Codex, com fetch e electron mockados. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-api-'));
const handlers = {};

const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') {
    return {
      app: { getPath: () => TMP },
      safeStorage: { isEncryptionAvailable: () => false },
      shell: { openExternal: async () => {} },
      ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    };
  }
  return originalLoad.apply(this, arguments);
};

const auth = require('../src/main/codexAuth');

// Sessão fake (base64, já que safeStorage está desligado no mock)
const idToken = 'h.' + Buffer.from(JSON.stringify({
  'https://api.openai.com/auth': { chatgpt_account_id: 'conta-api' },
})).toString('base64url') + '.s';
fs.writeFileSync(path.join(TMP, 'codex-auth.json'), Buffer.from(JSON.stringify({
  access_token: 'tok-123',
  refresh_token: 'ref-123',
  id_token: idToken,
  account_id: 'conta-api',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
})).toString('base64'));

let capturedFetch = null;
let rejectReasoning = false;
let rejectRateLimit = false;
global.fetch = async (url, options) => {
  capturedFetch = { url, options };
  if (rejectRateLimit && url.includes('/responses')) {
    rejectRateLimit = false;
    return {
      ok: false, status: 429,
      headers: { get: (k) => ({
        'x-codex-primary-used-percent': '96',
        'x-codex-secondary-used-percent': '71',
        'x-codex-primary-reset-after-seconds': '5400',
      }[k.toLowerCase()] || null) },
      text: async () => JSON.stringify({
        detail: "You've hit your usage limit.",
        error: { message: 'usage limit reached for gpt-5.5' },
      }),
    };
  }
  if (rejectReasoning && url.includes('/responses')) {
    rejectReasoning = false;
    return { ok: false, status: 400, text: async () => 'unsupported reasoning effort' };
  }
  if (url.includes('/models')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          { slug: 'gpt-6.1-sol', visibility: 'list' },
          { slug: 'gpt-5.5', visibility: 'list' },
          { slug: 'codex-auto-review', visibility: 'hide' },
        ],
      }),
    };
  }
  const chunks = [
    'data: {"type":"response.output_text.delta","delta":"Ol"}\n\n',
    'data: {"type":"response.output_text.delta","delta":"á!"}\n\n',
    'data: [DONE]\n\n',
  ];
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (i >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: Buffer.from(chunks[i++]) };
        },
      }),
    },
  };
};

require('../src/main/ipc/codexApi').register();
const handler = handlers['codex-api:stream-request'];
assert.ok(handler, 'handler registrado');

const eventos = [];
(async () => {
  // 0. catálogo de modelos: filtra modelos ocultos
  const listModels = handlers['codex-api:list-models'];
  assert.ok(listModels, 'handler de modelos registrado');
  const catalog = await listModels();
  assert.equal(catalog.error, false);
  assert.deepEqual(catalog.models, ['gpt-6.1-sol', 'gpt-5.5']);
  assert.ok(capturedFetch.url.includes('client_version='));
  console.log('✓ catálogo de modelos buscado e modelos ocultos filtrados');

  const result = await handler(
    { sender: { send: (name, data) => eventos.push({ name, data }) } },
    {
      mode: 'codex',
      reasoningEffort: 'xhigh',
      model: 'gpt-5-codex',
      input: [
        { role: 'system', content: 'Seja direto.' },
        { role: 'user', content: 'Oi' },
      ],
    }
  );

  assert.equal(result.error, false);
  assert.equal(capturedFetch.url, 'https://chatgpt.com/backend-api/codex/responses');
  assert.equal(capturedFetch.options.headers.Authorization, 'Bearer tok-123');
  assert.equal(capturedFetch.options.headers['Chatgpt-Account-Id'], 'conta-api');

  const body = JSON.parse(capturedFetch.options.body);
  assert.ok(body.instructions.includes('agente local'));
  assert.ok(!body.instructions.includes('Seja direto.'));
  assert.deepEqual(body.input, [{ type: 'message', role: 'user', content: 'Oi' }]);
  assert.equal(body.stream, true);
  assert.equal(body.store, false);
  assert.deepEqual(body.reasoning, { effort: 'xhigh', summary: 'auto' });
  assert.ok(Array.isArray(body.tools) && body.tools.length > 0);
  assert.equal(body.tools[0].type, 'function');
  console.log('✓ payload transformado + definições de ferramentas enviadas');

  const deltas = eventos.filter((e) => e.data.type === 'sse').map((e) => e.data.data.delta);
  assert.deepEqual(deltas, ['Ol', 'á!']);
  assert.ok(eventos.some((e) => e.data.type === 'done'));
  console.log('✓ stream SSE repassado via IPC + evento done');

  // Modo CHAT não deve enviar ferramentas ao modelo
  const fakeEvent = { sender: { send: () => {} } };
  const chatResult = await handler(fakeEvent, {
    mode: 'chat', model: 'gpt-5.5', input: [{ role: 'user', content: 'Oi' }],
  });
  assert.equal(chatResult.error, false);
  assert.equal(capturedFetch.options.body.includes('"tools"'), false);
  console.log('✓ modo chat envia conversa sem ferramentas');

  // Fallback: backend rejeita reasoning -> repetir sem o campo
  rejectReasoning = true;
  const noticeEvents = [];
  const fallbackEvent = { sender: { send: (name, data) => noticeEvents.push(data) } };
  const fallbackResult = await handler(fallbackEvent, {
    mode: 'codex', reasoningEffort: 'xhigh', model: 'gpt-5.5',
    input: [{ role: 'user', content: 'Oi' }],
  });
  assert.equal(fallbackResult.error, false);
  assert.equal(capturedFetch.options.body.includes('"reasoning"'), false);
  assert.ok(noticeEvents.some((e) => e.type === 'notice'));
  console.log('✓ fallback quando backend rejeita reasoning');

  // 429 -> evento rate-limit com tempo de renovação
  rejectRateLimit = true;
  const rlEvents = [];
  const rlEvent = { sender: { send: (name, data) => rlEvents.push(data) } };
  const rlResult = await handler(rlEvent, {
    mode: 'codex', model: 'gpt-5.5', input: [{ role: 'user', content: 'Oi' }],
  });
  assert.equal(rlResult.error, true);
  assert.equal(rlResult.status, 429);
  assert.ok(rlResult.message.includes('renova'));
  assert.ok(rlEvents.some((e) => e.type === 'rate-limit'));
  const rl = rlEvents.find((e) => e.type === 'rate-limit');
  assert.equal(rl.primary.leftPercent, 4);
  console.log('✓ 429 gera evento rate-limit com % e tempo de renovação');

  const history = require('../src/main/history');
  const chats = history.list().filter((e) => e.type === 'chat');
  assert.ok(chats.length >= 4, 'cada mensagem deve gerar entrada no histórico');
  assert.ok(chats.some((e) => e.status === 'done' && e.ok === true));
  assert.ok(chats.some((e) => e.status === 'error' && e.ok === false));
  console.log(`✓ histórico registra conversas (${chats.length} entradas)`);

  console.log('\nTODOS OS TESTES PASSARAM');
  process.exit(0);
})().catch((err) => {
  console.error('FALHA:', err);
  process.exit(1);
});
