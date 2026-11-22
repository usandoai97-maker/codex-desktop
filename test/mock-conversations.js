'use strict';

/** Teste de persistência e recuperação de conversas antigas. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-convs-'));
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => TMP } };
  return originalLoad.apply(this, arguments);
};

const conv = require('../src/main/conversations');

(async () => {
  const c1 = conv.create({ mode: 'chat', model: 'gpt-6.1-sol' });
  assert.equal(c1.title, 'Nova conversa');
  conv.appendMessages(c1.id, [
    { role: 'user', content: 'Primeira pergunta sobre extracao' },
    { role: 'assistant', content: 'Resposta antiga' },
  ]);
  assert.equal(conv.get(c1.id).title, 'Primeira pergunta sobre extracao');
  console.log('✓ conversa criada, título derivado da primeira mensagem');

  const c2 = conv.create({ mode: 'codex', model: 'gpt-5.5' });
  conv.appendMessages(c2.id, [{ role: 'user', content: 'Segunda conversa' }]);
  assert.equal(conv.active().id, c2.id);
  assert.equal(conv.list().length, 2);
  assert.ok(conv.list()[0].active);
  console.log('✓ múltiplas conversas e conversa ativa');

  conv.setActive(c1.id);
  assert.equal(conv.active().id, c1.id);
  assert.deepEqual(conv.active().messages.map((m) => m.role), ['user', 'assistant']);
  console.log('✓ abrir conversa antiga restaura mensagens');

  conv.rename(c1.id, 'Projeto antigo');
  assert.equal(conv.get(c1.id).title, 'Projeto antigo');
  console.log('✓ renomear');

  conv.remove(c1.id);
  assert.equal(conv.get(c1.id), null);
  assert.equal(conv.list().length, 1);
  assert.ok(conv.active());
  console.log('✓ excluir e trocar ativa');

  // sobrevive a "reinício" (novo require)
  delete require.cache[require.resolve('../src/main/conversations')];
  const conv2 = require('../src/main/conversations');
  assert.equal(conv2.list().length, 1);
  assert.equal(conv2.active().messages[0].content, 'Segunda conversa');
  console.log('✓ conversas persistem após reinício');

  console.log('\nTODOS OS TESTES PASSARAM');
  process.exit(0);
})().catch((err) => { console.error('FALHA:', err); process.exit(1); });
