'use strict';

/**
 * codexAuth.js — OAuth 2.0 + PKCE exatamente no espírito do vídeo.
 *
 * Responsabilidades (camada "Main Process / Node.js"):
 *  1. Gerar o par PKCE (code_verifier / code_challenge) e o state (CSRF).
 *  2. Subir um servidor HTTP temporário em 127.0.0.1:1455 (/auth/callback).
 *  3. Abrir o navegador em auth.openai.com/oauth/authorize.
 *  4. Validar o callback, trocar o código por tokens.
 *  5. Extrair o chatgpt_account_id do id_token (JWT).
 *  6. Criptografar e salvar os tokens com Electron safeStorage (DPAPI no Windows).
 *  7. Auto-refresh com buffer de 60s antes da expiração.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, safeStorage, shell } = require('electron');

// Constantes públicas do Codex CLI (obtidas do repositório oficial openai/codex).
// O vídeo esconde esses valores com "XXXX"; estes são os reais.
const CLIENT_ID = process.env.CODEX_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann';
const REDIRECT_PORT = Number(process.env.CODEX_REDIRECT_PORT || 1455);
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/auth/callback`;
const AUTHORIZE_URL = process.env.CODEX_AUTHORIZE_URL || 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = process.env.CODEX_TOKEN_URL || 'https://auth.openai.com/oauth/token';
const SCOPES = 'openid profile email offline_access api.connectors.read api.connectors.invoke';
const TOKEN_FILE = 'codex-auth.json';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos, como no vídeo
const DEMO = process.env.CODEX_DEMO_MODE === '1';

let pending = null;
let activeServer = null;

function tokenPath() {
  return path.join(app.getPath('userData'), TOKEN_FILE);
}

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

/* ---------------- Phase 3: armazenamento seguro ---------------- */

async function saveTokens(tokens) {
  const json = JSON.stringify({ ...tokens, saved_at: Date.now() });
  const encrypted = safeStorage.isEncryptionAvailable();
  const payload = encrypted
    ? safeStorage.encryptString(json).toString('base64')
    : Buffer.from(json).toString('base64');
  fs.mkdirSync(path.dirname(tokenPath()), { recursive: true });
  fs.writeFileSync(tokenPath(), payload, { mode: 0o600 });
  return encrypted ? 'os-keychain' : 'plain-base64';
}

async function loadTokens() {
  try {
    const raw = fs.readFileSync(tokenPath(), 'utf8');
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(raw, 'base64'))
      : Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function clearTokens() {
  try { fs.unlinkSync(tokenPath()); } catch { /* já não existe */ }
}

/* ---------------- JWT / Account ID ---------------- */

function extractAccountId(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return payload?.['https://api.openai.com/auth']?.chatgpt_account_id
        || payload?.chatgpt_account_id
        || null;
  } catch {
    return null;
  }
}

function extractEmail(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return payload.email || null;
  } catch {
    return null;
  }
}

/* ---------------- Troca / refresh de tokens ---------------- */

async function postToken(params, useJson = false) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: useJson
      ? { 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: useJson ? JSON.stringify(params) : new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* texto livre */ }
  if (!res.ok) {
    throw new Error(`Token endpoint ${res.status}: ${text.slice(0, 400)}`);
  }
  return data;
}

async function exchangeCodeForTokens(code, codeVerifier) {
  // O Codex CLI usa x-www-form-urlencoded para authorization_code.
  return postToken({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });
}

async function refreshAccessToken(refreshToken) {
  // O código oficial usa JSON para refresh do ChatGPT.
  return postToken({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  }, true);
}

function withExpiry(tokens) {
  return {
    ...tokens,
    expires_at: Math.floor(Date.now() / 1000) + Number(tokens.expires_in || 3600),
  };
}

/* ---------------- Auto-refresh ---------------- */

async function getValidAccessToken() {
  const tokens = await loadTokens();
  if (!tokens) return null;

  // buffer de 60s antes da expiração real
  const isExpired = (Date.now() / 1000) >= (tokens.expires_at - 60);
  if (!isExpired) {
    return {
      access_token: tokens.access_token,
      account_id: tokens.account_id,
      token_type: tokens.token_type || 'Bearer',
    };
  }

  if (!tokens.refresh_token) return null;

  try {
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    // Merge: mantém campos antigos e substitui pelos novos (inclusive novo refresh_token).
    const merged = withExpiry({ ...tokens, ...refreshed });
    merged.account_id = tokens.account_id
      || extractAccountId(refreshed.id_token || tokens.id_token);
    await saveTokens(merged);
    return {
      access_token: merged.access_token,
      account_id: merged.account_id,
      token_type: merged.token_type || 'Bearer',
    };
  } catch (err) {
    console.error('[codexAuth] refresh falhou:', err.message);
    return null;
  }
}

async function getAuthStatus() {
  const tokens = await loadTokens();
  if (!tokens) return { authenticated: false, account_id: null, email: null, expires: null };
  return {
    authenticated: true,
    account_id: tokens.account_id,
    email: tokens.email,
    expires: tokens.expires_at,
  };
}

/* ---------------- Phase 1/2: fluxo completo ---------------- */

function resultPage(title, message, ok) {
  const color = ok ? '#10a37f' : '#d9534f';
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8">
  <title>${title}</title><style>
  body{font-family:system-ui,sans-serif;background:#0d0d0d;color:#ececec;display:grid;
  place-items:center;height:100vh;margin:0}div{text-align:center}h1{color:${color}}
  p{color:#aaa}</style></head><body><div><h1>${title}</h1><p>${message}</p>
  <p>Você pode fechar esta aba e voltar ao aplicativo.</p></div></body></html>`;
}

function finish(result) {
  if (!pending) return;
  const { resolve, timer, server } = pending;
  clearTimeout(timer);
  try { server.close(); } catch { /* já fechado */ }
  if (activeServer === server) activeServer = null;
  pending = null;
  resolve(result);
}

async function startAuthFlow() {
  if (DEMO) {
    await saveTokens(withExpiry({
      access_token: 'demo-access-token',
      refresh_token: 'demo-refresh-token',
      id_token: 'header.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiZGVtby1hY2NvdW50In19.sig',
      account_id: 'demo-account',
      email: 'demo@exemplo.local',
      token_type: 'Bearer',
    }));
    return { success: true, user: { accountId: 'demo-account', email: 'demo@exemplo.local' } };
  }

  if (pending) return { success: false, error: 'Uma autenticação já está em andamento.' };

  // PKCE: verifier de 96 bytes aleatórios -> challenge SHA-256
  const codeVerifier = crypto.randomBytes(96).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(32).toString('base64url');

  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      let url;
      try { url = new URL(req.url, `http://127.0.0.1:${REDIRECT_PORT}`); }
      catch { res.writeHead(400); res.end(); return; }

      if (url.pathname !== '/auth/callback') {
        res.writeHead(404); res.end('Not found');
        return;
      }

      // CSRF: validar state antes de usar o código
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(resultPage('State mismatch', 'A requisição pode ter sido adulterada.', false));
        return;
      }

      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (error || !code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(resultPage('Login cancelado', error || 'Nenhum código retornado.', false));
        finish({ success: false, error: error || 'missing_code' });
        return;
      }

      try {
        const tokens = await exchangeCodeForTokens(code, codeVerifier);
        const accountId = extractAccountId(tokens.id_token);
        const email = extractEmail(tokens.id_token);
        const storage = await saveTokens(withExpiry({ ...tokens, account_id: accountId, email }));

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(resultPage('Login efetuado', 'Tokens salvos com ' + storage + '.', true));
        finish({ success: true, user: { accountId, email } });
      } catch (err) {
        console.error('[codexAuth] troca de código falhou:', err);
        res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(resultPage('Falha na autenticação', String(err.message).slice(0, 300), false));
        finish({ success: false, error: err.message });
      }
    });

    activeServer = server;
    const timer = setTimeout(() => {
      try { server.close(); } catch { /* ignore */ }
      if (activeServer === server) activeServer = null;
      pending = null;
      resolve({ success: false, error: 'Timeout: login não concluído em 5 minutos.' });
    }, AUTH_TIMEOUT_MS);

    pending = { resolve, timer, server };

    server.on('error', (err) => {
      clearTimeout(timer);
      pending = null;
      resolve({ success: false, error: `Não foi possível abrir a porta ${REDIRECT_PORT}: ${err.message}` });
    });

    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        scope: SCOPES,
      });
      const authUrl = `${AUTHORIZE_URL}?${params.toString()}`;
      console.log('[codexAuth] abrindo navegador:', authUrl);
      shell.openExternal(authUrl);
    });
  });
}

async function logout() {
  await clearTokens();
  return { success: true };
}

module.exports = {
  startAuthFlow,
  getAuthStatus,
  getValidAccessToken,
  logout,
  CLIENT_ID,
  REDIRECT_URI,
  AUTHORIZE_URL,
  SCOPES,
  DEMO,
};
