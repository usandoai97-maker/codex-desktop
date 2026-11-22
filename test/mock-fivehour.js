'use strict';

/** Teste do contador local de 5h (Chat e Codex). */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-5h-'));
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => TMP } };
  return originalLoad.apply(this, arguments);
};

const fiveHour = require('../src/main/fiveHour');
const { updateSettings } = require('../src/main/settings');

(async () => {
  updateSettings({ workingDirectory: TMP, fiveHourLimit: 10 });

  updateSettings({ fiveHourTokenLimit: 1000 });
  fiveHour.clear();
  assert.equal(fiveHour.status().count, 0);

  fiveHour.recordMessage();
  fiveHour.recordMessage();
  fiveHour.addTokens(300);
  fiveHour.addTokens(200);
  let s = fiveHour.status();
  assert.equal(s.count, 2);
  assert.equal(s.tokens, 500);
  assert.equal(s.windowSeconds, 18000);
  assert.equal(s.limit, 10);
  assert.equal(s.leftPercent, 80);
  assert.equal(s.tokenLeftPercent, 50);
  assert.ok(s.resetAt > Date.now());
  assert.ok(s.resetAfterSeconds > 0 && s.resetAfterSeconds <= 18000);
  console.log('✓ contador registra mensagens com janela de 5h');

  // Simula mensagem antiga (fora da janela) no arquivo
  const f = path.join(TMP, 'five-hour.json');
  fs.writeFileSync(f, JSON.stringify([Date.now() - 6 * 3600 * 1000, Date.now()]));
  delete require.cache[require.resolve('../src/main/fiveHour')];
  const again = require('../src/main/fiveHour');
  s = again.status();
  assert.equal(s.count, 1);
  console.log('✓ mensagens com mais de 5h são descartadas');

  console.log('\nTODOS OS TESTES PASSARAM');
  process.exit(0);
})().catch((err) => { console.error('FALHA:', err); process.exit(1); });
