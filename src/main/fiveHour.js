'use strict';

/**
 * Medidor LOCAL de consumo em janela deslizante de 5 horas.
 *
 * A API da Codex expoe apenas a janela da assinatura (nesta conta Free: 30 dias).
 * O limite de creditos/tokens de 5h do ChatGPT Web nao vem nesse OAuth. Aqui o
 * consumo real e medido a partir dos eventos `response.completed` das respostas,
 * tanto no modo Chat quanto no Codex.
 */

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { getSettings } = require('./settings');

const WINDOW_MS = 5 * 60 * 60 * 1000;
let cache = null;

function file() { return path.join(app.getPath('userData'), 'five-hour.json'); }

function load() {
  if (cache) return cache;
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cache = Array.isArray(data) ? data.map((e) =>
      typeof e === 'number' ? { at: e, tokens: 0, type: 'message' } : e) : [];
  } catch { cache = []; }
  return prune();
}

function prune() {
  const now = Date.now();
  cache = (cache || []).filter((e) => now - (e.at || 0) < WINDOW_MS);
  return cache;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache), 'utf8');
  } catch { /* segue em memoria */ }
}

function recordMessage() {
  load();
  cache.push({ at: Date.now(), tokens: 0, type: 'message' });
  persist();
  return status();
}

function addTokens(tokens) {
  const n = Number(tokens) || 0;
  if (n <= 0) return status();
  load();
  cache.push({ at: Date.now(), tokens: n, type: 'tokens' });
  persist();
  return status();
}

// compatibilidade com chamadas antigas
function record(tokens) {
  recordMessage();
  if (tokens) addTokens(tokens);
  return status();
}

function status() {
  load();
  const items = prune();
  const now = Date.now();
  const oldest = items.length ? Math.min(...items.map((e) => e.at)) : null;
  const resetAt = oldest ? oldest + WINDOW_MS : null;
  const secondsLeft = resetAt ? Math.max(0, Math.round((resetAt - now) / 1000)) : null;
  const cfg = getSettings();
  const msgLimit = Number(cfg.fiveHourLimit) || 0;
  const tokenLimit = Number(cfg.fiveHourTokenLimit) || 0;
  const count = items.filter((e) => e.type === 'message').length;
  const tokens = items.reduce((sum, e) => sum + (e.tokens || 0), 0);
  return {
    ok: true,
    source: 'local',
    windowSeconds: 18000,
    count,
    tokens,
    limit: msgLimit,
    tokenLimit,
    leftPercent: msgLimit > 0 ? Math.max(0, Math.min(100, Math.round((1 - count / msgLimit) * 100))) : null,
    tokenLeftPercent: tokenLimit > 0 ? Math.max(0, Math.min(100, Math.round((1 - tokens / tokenLimit) * 100))) : null,
    resetAt,
    resetAfterSeconds: secondsLeft,
    plan: cfg.mode || 'chat',
  };
}

function clear() { cache = []; persist(); }

module.exports = { recordMessage, addTokens, record, status, clear, WINDOW_MS };
