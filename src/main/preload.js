'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The Preload Bridge — contextIsolation impede que o renderer acesse Node APIs.
 * Este é o único contrato entre a UI e o main process.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  codexAuth: {
    start: () => ipcRenderer.invoke('codex-auth:start'),
    getStatus: () => ipcRenderer.invoke('codex-auth:get-status'),
    getToken: () => ipcRenderer.invoke('codex-auth:get-token'),
    logout: () => ipcRenderer.invoke('codex-auth:logout'),
  },
  codexApi: {
    listModels: () => ipcRenderer.invoke('codex-api:list-models'),
    sendRequest: (payload) => ipcRenderer.invoke('codex-api:stream-request', payload),
    onStreamChunk: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('codex-api:stream-chunk', listener);
      return () => ipcRenderer.removeListener('codex-api:stream-chunk', listener);
    },
  },
  tools: {
    list: () => ipcRenderer.invoke('tools:list'),
    invoke: (name, args) => ipcRenderer.invoke('tools:invoke', { name, args }),
    history: () => ipcRenderer.invoke('tools:history'),
    allHistory: () => ipcRenderer.invoke('history:list'),
    clearHistory: () => ipcRenderer.invoke('history:clear'),
    onPermissionRequest: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('tool:permission-request', listener);
      return () => ipcRenderer.removeListener('tool:permission-request', listener);
    },
    answerPermission: (id, allowed) => ipcRenderer.invoke('tool:permission-response', { id, allowed }),
  },
  conversations: {
    list: () => ipcRenderer.invoke('conv:list'),
    active: () => ipcRenderer.invoke('conv:active'),
    create: (meta) => ipcRenderer.invoke('conv:create', meta),
    get: (id) => ipcRenderer.invoke('conv:get', id),
    select: (id) => ipcRenderer.invoke('conv:select', id),
    append: (id, messages) => ipcRenderer.invoke('conv:append', { id, messages }),
    rename: (id, title) => ipcRenderer.invoke('conv:rename', { id, title }),
    remove: (id) => ipcRenderer.invoke('conv:remove', id),
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    active: () => ipcRenderer.invoke('plugins:active'),
    activate: (id) => ipcRenderer.invoke('plugins:activate', id),
    run: (id, task) => ipcRenderer.invoke('plugins:run', { id, task }),
  },
  usage: {
    get: () => ipcRenderer.invoke('usage:get'),
    cached: () => ipcRenderer.invoke('usage:cached'),
    local5h: () => ipcRenderer.invoke('usage:local5h'),
    openSettings: () => ipcRenderer.invoke('usage:open-settings'),
  },
  mcp: {
    status: () => ipcRenderer.invoke('mcp:status'),
    refresh: () => ipcRenderer.invoke('mcp:refresh'),
    servers: () => ipcRenderer.invoke('mcp:servers'),
    addServer: (server) => ipcRenderer.invoke('mcp:add-server', server),
    removeServer: (id) => ipcRenderer.invoke('mcp:remove-server', id),
    toggleServer: (id) => ipcRenderer.invoke('mcp:toggle-server', id),
  },
  dialog: {
    chooseFile: () => ipcRenderer.invoke('dialog:choose-file'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    chooseFolder: () => ipcRenderer.invoke('settings:choose-folder'),
  },
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
  platform: process.platform,
});
