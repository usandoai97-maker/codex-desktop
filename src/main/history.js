'use strict';

/** Histórico unificado (chat + ferramentas), persistido em userData/history.json. */

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const MAX = 200;
let cache = null;

function file() { return path.join(app.getPath('userData'), 'history.json'); }

function list() {
  if (cache) return cache;
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cache = Array.isArray(data) ? data : [];
  } catch {
    cache = [];
  }
  return cache;
}

function add(entry) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item = { id, at: Date.now(), ...entry };
  cache = [item, ...list()].slice(0, MAX);
  persist();
  return id;
}

function update(id, patch) {
  cache = list().map((item) => (item.id === id ? { ...item, ...patch } : item));
  persist();
}

function clear() {
  cache = [];
  try { fs.unlinkSync(file()); } catch { /* ignore */ }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache), 'utf8');
  } catch { /* histórico em memória ainda funciona */ }
}

module.exports = { list, add, update, clear };
