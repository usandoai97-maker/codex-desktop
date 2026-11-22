'use strict';

const { ipcMain } = require('electron');
const mcp = require('../mcp/manager');
const { getSettings, updateSettings } = require('../settings');

function register() {
  ipcMain.handle('mcp:status', () => mcp.status());

  ipcMain.handle('mcp:refresh', () => mcp.refresh());

  ipcMain.handle('mcp:servers', () => getSettings().mcpServers || []);

  ipcMain.handle('mcp:add-server', (_event, server) => {
    const servers = [...(getSettings().mcpServers || [])];
    const id = server.id || `srv_${Date.now()}`;
    const existing = servers.findIndex((s) => s.id === id);
    const entry = {
      id,
      name: server.name || id,
      command: server.command || '',
      args: server.args || [],
      cwd: server.cwd || '',
      env: server.env || {},
      enabled: server.enabled !== false,
    };
    if (existing >= 0) servers[existing] = entry; else servers.push(entry);
    updateSettings({ mcpServers: servers });
    return entry;
  });

  ipcMain.handle('mcp:remove-server', (_event, id) => {
    const servers = (getSettings().mcpServers || []).filter((s) => s.id !== id);
    updateSettings({ mcpServers: servers });
    return mcp.disconnect(id).then(() => servers);
  });

  ipcMain.handle('mcp:toggle-server', async (_event, id) => {
    const servers = (getSettings().mcpServers || []).map((s) =>
      s.id === id ? { ...s, enabled: s.enabled === false } : s
    );
    updateSettings({ mcpServers: servers });
    await mcp.refresh();
    return servers;
  });
}

module.exports = { register };
