'use strict';

const { ipcMain } = require('electron');
const plugins = require('../plugins');
const { runPipeline } = require('../plugins/pipeline');
const { getSettings, updateSettings } = require('../settings');

function register() {
  ipcMain.handle('plugins:list', () => plugins.list());

  ipcMain.handle('plugins:active', () => getSettings().activePlugin || '');

  ipcMain.handle('plugins:activate', (_e, id) => {
    const plugin = plugins.get(id);
    if (!plugin) return { ok: false, message: 'Plugin não encontrado.' };
    updateSettings({ activePlugin: plugin.id });
    return { ok: true, id: plugin.id, name: plugin.name };
  });

  ipcMain.handle('plugins:run', async (event, { id, task }) => {
    const plugin = plugins.get(id);
    if (!plugin) return { error: true, message: 'Plugin não encontrado.' };
    if (!plugin.pipeline) return { error: true, message: 'Este plugin atua como prompt — ative-o no chat.' };
    return runPipeline(plugin, task, event);
  });
}

module.exports = { register };
