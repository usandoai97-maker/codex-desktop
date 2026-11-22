'use strict';

/**
 * Teste end-to-end do fluxo OAuth/PKCE com mocks locais.
 * Roda com: node test/mock-flow.js
 * Não fala com a OpenAI: substitui "electron" e o endpoint de token.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-flow-'));
const TOKEN_PORT = 9987;
const REDIRECT_PORT = 1457;
const captured = { authUrl: null, refreshCalls: 0 };

process.env.CODEX_REDIRECT_PORT = String(REDIRECT_PORT);
process.env.CODEX_TOKEN_URL = `http://127.0.0.1:${TOKEN_PORT}/token`;
process.env.CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';

// Stub do módulo electron
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: { getPath: () => TMP },
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (s) => Buffer.from(s),
        decryptString: (b) => b.toString(),
      },
      shell: {
        openExternal: async (url) => { captured.authUrl = url; },
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

const auth = require('../src/main/codexAuth');

const idToken = 'h.' + Buffer.from(JSON.stringify({
  email: 'teste@exemplo.com',
  'https://api.openai.com/auth': { chatgpt_account_id: 'conta-teste-123' },
})).toString('base64url') + '.s';

function tokenResponse(refreshBase) {
  return {
    access_token: `access-${refreshBase}`,
    refresh_token: `refresh-${refreshBase}`,
    id_token: idToken,
    expires_in: 3600,
    token_type: 'Bearer',
  };
}

const tokenServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const params = new URLSearchParams(body);
    if ((params.get('grant_type') || JSON.parse(body || '{}').grant_type) === 'refresh_token') {
      captured.refreshCalls++;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(tokenResponse(captured.refreshCalls)));
  });
});

function waitFor(predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('timeout aguardando condição'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

function callback(query) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${REDIRECT_PORT}/auth/callback?${query}`, (res) => {
      res.resume();
      res.on('end', resolve);
    }).on('error', reject);
  });
}

(async () => {
  await new Promise((r) => tokenServer.listen(TOKEN_PORT, '127.0.0.1', r));

  // 1. inicia o fluxo (abre "navegador" stub)
  const flow = auth.startAuthFlow();
  await waitFor(() => captured.authUrl !== null);

  const authorizeUrl = new URL(captured.authUrl);
  assert.equal(authorizeUrl.searchParams.get('response_type'), 'code');
  assert.ok(authorizeUrl.searchParams.get('code_challenge'));
  assert.equal(authorizeUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorizeUrl.searchParams.get('state'));
  assert.equal(authorizeUrl.searchParams.get('client_id'), 'app_EMoamEEZ73f0CkXaXp7hrann');
  console.log('✓ URL de autorização com PKCE + state');

  // 2. callback com state ERRADO deve ser rejeitado
  await callback('code=abc&state=errado');
  console.log('✓ callback com state inválido rejeitado');

  // 3. callback correto
  const state = authorizeUrl.searchParams.get('state');
  await callback(`code=abc-code&state=${encodeURIComponent(state)}`);
  const result = await flow;
  assert.equal(result.success, true);
  assert.equal(result.user.accountId, 'conta-teste-123');
  console.log('✓ callback válido: código trocado por tokens');

  // 4. sessão persistida e account ID extraído do JWT
  const status = await auth.getAuthStatus();
  assert.equal(status.authenticated, true);
  assert.equal(status.account_id, 'conta-teste-123');
  console.log('✓ sessão persistida + account_id extraído do JWT');

  // 5. token válido
  const valid = await auth.getValidAccessToken();
  assert.equal(valid.access_token, 'access-0');
  console.log('✓ getValidAccessToken retorna token');

  // 6. força expiração -> auto-refresh
  const file = path.join(TMP, 'codex-auth.json');
  const stored = JSON.parse(Buffer.from(fs.readFileSync(file, 'utf8'), 'base64').toString());
  stored.expires_at = Math.floor(Date.now() / 1000) - 10;
  fs.writeFileSync(file, Buffer.from(JSON.stringify(stored)).toString('base64'));
  const refreshed = await auth.getValidAccessToken();
  assert.ok(captured.refreshCalls >= 1);
  assert.equal(refreshed.access_token, 'access-1');
  console.log('✓ auto-refresh funcionou (novo access_token)');

  // 7. logout
  await auth.logout();
  assert.equal((await auth.getAuthStatus()).authenticated, false);
  console.log('✓ logout removeu a sessão');

  console.log('\nTODOS OS TESTES PASSARAM');
  tokenServer.close();
  process.exit(0);
})().catch((err) => {
  console.error('FALHA:', err);
  tokenServer.close();
  process.exit(1);
});
