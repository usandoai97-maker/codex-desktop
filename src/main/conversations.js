'use strict';

/** Conversas persistidas em userData/conversations.json. */

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

// SEM limite e SEM expiração: conversas só saem se o usuário clicar em Excluir.
let cache = null;

function file() { return path.join(app.getPath('userData'), 'conversations.json'); }

function load() {
  if (cache) return cache;
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cache = data && Array.isArray(data.items)
      ? data
      : { activeId: null, items: [] };
  } catch {
    cache = { activeId: null, items: [] };
  }
  return cache;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache), 'utf8');
  } catch { /* memória ainda funciona */ }
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function list() {
  return load().items
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      mode: c.mode,
      model: c.model,
      count: c.messages.length,
      active: c.id === load().activeId,
      preview: (c.messages.find((m) => m.role === 'user')?.content || '').slice(0, 120),
    }));
}

function get(id) {
  return load().items.find((c) => c.id === id) || null;
}

function active() {
  const data = load();
  return data.items.find((c) => c.id === data.activeId) || null;
}

function create(meta = {}) {
  const now = Date.now();
  const conv = {
    id: makeId(),
    title: 'Nova conversa',
    createdAt: now,
    updatedAt: now,
    mode: meta.mode || 'chat',
    model: meta.model || '',
    messages: [],
  };
  load().items.push(conv);
  load().activeId = conv.id;
  persist();
  return conv;
}

function setActive(id) {
  if (!get(id)) return null;
  load().activeId = id;
  persist();
  return get(id);
}

function appendMessages(id, messages) {
  const conv = get(id);
  if (!conv) return null;
  for (const m of messages) {
    conv.messages.push({ role: m.role, content: m.content, at: Date.now() });
    if (conv.title === 'Nova conversa' && m.role === 'user') {
      conv.title = String(m.content).replace(/\s+/g, ' ').trim().slice(0, 60) || 'Nova conversa';
    }
  }
  conv.updatedAt = Date.now();
  persist();
  return conv;
}

function rename(id, title) {
  const conv = get(id);
  if (!conv) return null;
  conv.title = String(title).slice(0, 100) || conv.title;
  conv.updatedAt = Date.now();
  persist();
  return conv;
}

function remove(id) {
  const data = load();
  data.items = data.items.filter((c) => c.id !== id);
  if (data.activeId === id) {
    data.activeId = data.items.length ? data.items[0].id : null;
  }
  persist();
  return data.activeId;
}

function clearAll() {
  cache = { activeId: null, items: [] };
  persist();
}

module.exports = { list, get, active, create, setActive, appendMessages, rename, remove, clearAll };
