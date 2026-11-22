'use strict';

/** Consulta de uso/limites da conta ChatGPT + cache dos headers x-codex-*. */

const auth = require('./codexAuth');

const USAGE_URL = process.env.CODEX_USAGE_URL || 'https://chatgpt.com/backend-api/wham/usage';
const SETTINGS_URL = 'https://chatgpt.com/codex/settings/usage';

let headerCache = null;
let lastError = null;

function num(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function clamp(n) { return Math.max(0, Math.min(100, n)); }

function normReset(value) {
  if (value === undefined) return undefined;
  return value > 10_000_000_000 ? Math.round(value / 1000) : value;
}

function normWindow(w, nowSec = Math.floor(Date.now() / 1000)) {
  if (!w || typeof w !== 'object') return null;
  const used = num(w.used_percent ?? w.usedPercent);
  if (used === undefined) return null;
  const usedPercent = clamp(used);
  const resetAt = normReset(num(w.reset_at ?? w.resetAt));
  let resetAfterSeconds = num(w.reset_after_seconds ?? w.resetAfterSeconds);
  if (resetAfterSeconds === undefined && resetAt !== undefined) {
    resetAfterSeconds = Math.max(0, Math.round(resetAt - nowSec));
  }
  return {
    usedPercent,
    leftPercent: +(100 - usedPercent).toFixed(1),
    resetAt,
    resetAfterSeconds,
    windowSeconds: num(w.limit_window_seconds ?? w.windowSeconds),
  };
}

function normLimit(limit, name, extra = {}) {
  if (!limit) return null;
  return {
    id: extra.id || name,
    name,
    primary: normWindow(limit.primary_window),
    secondary: normWindow(limit.secondary_window),
    allowed: limit.allowed,
    limitReached: limit.limit_reached,
    ...extra,
  };
}

function normalize(api) {
  const additional = [];
  for (const item of api.additional_rate_limits || []) {
    const name = item.limit_name || item.metered_feature || 'Limite adicional';
    const l = normLimit(item.rate_limit, name, {
      id: item.metered_feature || name,
      meteredFeature: item.metered_feature,
    });
    if (l) additional.push(l);
  }
  const review = normLimit(api.code_review_rate_limit, 'Code Review', { id: 'code_review' });
  if (review) additional.push(review);

  const credits = api.credits ? {
    hasCredits: api.credits.has_credits,
    unlimited: api.credits.unlimited,
    overageLimitReached: api.credits.overage_limit_reached,
    balance: api.credits.balance,
  } : null;

  return {
    ok: true,
    source: 'api',
    fetchedAt: Date.now(),
    email: api.email,
    plan: api.plan_type,
    accountId: api.account_id,
    defaultLimit: normLimit(api.rate_limit, 'Codex', { id: 'codex' }),
    additionalLimits: additional,
    credits,
    reachedType: api.rate_limit_reached_type,
    settingsUrl: SETTINGS_URL,
    raw: api,
  };
}

async function fetchUsage() {
  const tokenResult = await auth.getValidAccessToken();
  if (!tokenResult) {
    return { ok: false, error: 'Não autenticado. Faça login com o ChatGPT primeiro.' };
  }
  try {
    const response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${tokenResult.access_token}`,
        'Chatgpt-Account-Id': tokenResult.account_id,
        Accept: 'application/json',
        'User-Agent': 'CodexDesktop/1.0',
      },
    });
    if (!response.ok) {
      const text = await response.text();
      lastError = `HTTP ${response.status}: ${text.slice(0, 300)}`;
      const cached = getCached();
      if (cached) return { ...cached, warning: lastError };
      return { ok: false, error: lastError };
    }
    const api = await response.json();
    const result = normalize(api);
    headerCache = result;
    lastError = null;
    return result;
  } catch (err) {
    lastError = err.message;
    const cached = getCached();
    if (cached) return { ...cached, warning: lastError };
    return { ok: false, error: lastError };
  }
}

/** Lê headers x-codex-* de uma resposta e atualiza o cache sem custo extra. */
function ingestHeaders(headers) {
  try {
    const get = (k) => (headers && typeof headers.get === 'function' ? headers.get(k) : headers?.[k]);
    const p = num(get('x-codex-primary-used-percent'));
    const s = num(get('x-codex-secondary-used-percent'));
    if (p === undefined && s === undefined) return;

    const base = headerCache || {
      ok: true, source: 'headers', fetchedAt: Date.now(),
      defaultLimit: { id: 'codex', name: 'Codex' },
    };
    base.defaultLimit = base.defaultLimit || { id: 'codex', name: 'Codex' };
    if (p !== undefined) base.defaultLimit.primary = {
      usedPercent: clamp(p), leftPercent: +(100 - clamp(p)).toFixed(1),
      resetAfterSeconds: num(get('x-codex-primary-reset-after-seconds')),
      resetAt: normReset(num(get('x-codex-primary-reset-at'))),
    };
    if (s !== undefined) base.defaultLimit.secondary = {
      usedPercent: clamp(s), leftPercent: +(100 - clamp(s)).toFixed(1),
      resetAfterSeconds: num(get('x-codex-secondary-reset-after-seconds')),
      resetAt: normReset(num(get('x-codex-secondary-reset-at'))),
    };
    if (!base.settingsUrl) base.settingsUrl = SETTINGS_URL;
    base.source = 'headers';
    base.fetchedAt = Date.now();
    headerCache = base;
  } catch { /* headers opcionais */ }
}

function getCached() { return headerCache; }

function rateLimitInfo(response, text) {
  ingestHeaders(response.headers);
  let resetSeconds;
  let message = text.slice(0, 400);
  try {
    const data = JSON.parse(text);
    const m = /reset(?:s|_at|_after)?["':\s]*(\d+)/i.exec(text);
    if (m) resetSeconds = num(m[1]);
    message = data?.error?.message || data?.detail || message;
  } catch { /* texto livre */ }
  const cached = getCached();
  return {
    message,
    resetSeconds,
    primary: cached?.defaultLimit?.primary,
    secondary: cached?.defaultLimit?.secondary,
  };
}

module.exports = { fetchUsage, ingestHeaders, getCached, rateLimitInfo, SETTINGS_URL };
