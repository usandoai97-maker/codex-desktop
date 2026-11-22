'use strict';

/**
 * Contador LOCAL de janela de 5 horas.
 *
 * A API da Codex so expoe a janela da assinatura (nesta conta Free: 30 dias).
 * O limite de 5h do ChatGPT Web nao e disponibilizado via OAuth. Este modulo
 * registra as mensagens enviadas pelo proprio app numa janela deslizante de 5h,
 * para que Chat e Codex tenham um medidor de 5 horas real e verificavel.
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
    cache = Array.isArray(data) ? data : [];
  } catch { cache = []; }
  return prune();
}

function prune() {
  const now = Date.now();
  cache = loadRaw().filter((t) => now - t < WINDOW_MS);
  return cache;
}

function loadRaw() { return cache || []; }

function persist() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache), 'utf8');
  } catch { /* segue em memoria */ }
}

function record() {
  const now = Date.now();
  cache = load().filter((t) => now - t < WINDOW_MS);
  cache.push(now);
  persist();
  return status();
}

function status() {
  load();
  const items = prune();
  const now = Date.now();
  const oldest = items.length ? Math.min(...items) : null;
  const resetAt = oldest ? oldest + WINDOW_MS : null;
  const secondsLeft = resetAt ? Math.max(0, Math.round((resetAt - now) / 1000)) : null;
  const limit = Number(getSettings().fiveHourLimit) || 0;
  return {
    ok: true,
    source: 'local',
    windowSeconds: 18000,
    count: items.length,
    limit,
    leftPercent: limit > 0 ? Math.max(0, Math.min(100, Math.round((1 - items.length / limit) * 100))) : null,
    resetAt,
    resetAfterSeconds: secondsLeft,
    plan: getSettings().mode || 'chat',
  };
}

function clear() { cache = []; persist(); }

module.exports = { record, status, clear, WINDOW_MS };
