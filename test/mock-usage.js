'use strict';

/** Teste do painel de uso com endpoint mockado. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-usage-'));
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') {
    return {
      app: { getPath: () => TMP },
      safeStorage: { isEncryptionAvailable: () => false },
      shell: { openExternal: async () => {} },
    };
  }
  return originalLoad.apply(this, arguments);
};

const idToken = 'h.' + Buffer.from(JSON.stringify({
  'https://api.openai.com/auth': { chatgpt_account_id: 'acc-1' },
})).toString('base64url') + '.s';
fs.writeFileSync(path.join(TMP, 'codex-auth.json'), Buffer.from(JSON.stringify({
  access_token: 'tok', id_token: idToken, account_id: 'acc-1',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
})).toString('base64'));

const resetAt = Math.floor(Date.now() / 1000) + 3600;
global.fetch = async (url, options) => {
  assert.ok(url.includes('/backend-api/wham/usage'));
  assert.equal(options.headers.Authorization, 'Bearer tok');
  assert.equal(options.headers['Chatgpt-Account-Id'], 'acc-1');
  return {
    ok: true,
    status: 200,
    json: async () => ({
      email: 'teste@exemplo.com',
      plan_type: 'plus',
      account_id: 'acc-1',
      rate_limit: {
        primary_window: { used_percent: 42, reset_at: resetAt, limit_window_seconds: 18000 },
        secondary_window: { used_percent: 70, reset_at: resetAt + 604800 },
      },
      additional_rate_limits: [{
        limit_name: 'GPT-5.5 limit',
        rate_limit: { primary_window: { used_percent: 10 } },
      }],
      credits: { balance: 123, unlimited: false },
    }),
  };
};

const usage = require('../src/main/usage');

(async () => {
  const data = await usage.fetchUsage();
  assert.equal(data.ok, true);
  assert.equal(data.email, 'teste@exemplo.com');
  assert.equal(data.plan, 'plus');
  assert.equal(data.defaultLimit.primary.leftPercent, 58);
  assert.equal(data.defaultLimit.primary.windowSeconds, 18000);
  assert.equal(data.defaultLimit.secondary.leftPercent, 30);
  assert.equal(data.additionalLimits.length, 1);
  assert.equal(data.additionalLimits[0].name, 'GPT-5.5 limit');
  assert.equal(data.credits.balance, 123);
  console.log('✓ endpoint de uso normalizado (5h, semanal, adicional, créditos)');

  // headers x-codex-* atualizam o cache sem chamada extra
  usage.ingestHeaders({
    get: (k) => ({
      'x-codex-primary-used-percent': '85',
      'x-codex-secondary-used-percent': '20',
      'x-codex-primary-reset-after-seconds': '1800',
    }[k.toLowerCase()] || null),
  });
  const cached = usage.getCached();
  assert.equal(cached.defaultLimit.primary.leftPercent, 15);
  assert.equal(cached.defaultLimit.secondary.leftPercent, 80);
  assert.equal(cached.defaultLimit.primary.resetAfterSeconds, 1800);
  console.log('✓ headers x-codex-* atualizam cache de uso');

  console.log('\nTODOS OS TESTES PASSARAM');
  process.exit(0);
})().catch((err) => { console.error('FALHA:', err); process.exit(1); });
