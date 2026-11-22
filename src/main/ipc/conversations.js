'use strict';

const { ipcMain } = require('electron');
const conv = require('../conversations');

function register() {
  ipcMain.handle('conv:list', () => conv.list());
  ipcMain.handle('conv:active', () => conv.active());
  ipcMain.handle('conv:create', (_e, meta) => conv.create(meta));
  ipcMain.handle('conv:get', (_e, id) => conv.get(id));
  ipcMain.handle('conv:select', (_e, id) => conv.setActive(id));
  ipcMain.handle('conv:append', (_e, { id, messages }) => conv.appendMessages(id, messages));
  ipcMain.handle('conv:rename', (_e, { id, title }) => conv.rename(id, title));
  ipcMain.handle('conv:remove', (_e, id) => conv.remove(id));
}

module.exports = { register };
