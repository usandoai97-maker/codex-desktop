'use strict';

const { ipcMain, dialog } = require('electron');
const tools = require('../tools');
const history = require('../history');
const { getSettings, updateSettings } = require('../settings');

function register() {
  ipcMain.handle('tools:list', () => tools.summary());

  ipcMain.handle('tools:invoke', async (_event, { name, args }) => tools.invoke(name, args));

  ipcMain.handle('tools:history', () => tools.getHistory());

  ipcMain.handle('history:list', () => history.list().slice(0, 100));

  ipcMain.handle('history:clear', () => { history.clear(); return { ok: true }; });

  ipcMain.handle('settings:get', () => getSettings());

  ipcMain.handle('settings:set', (_event, patch) => updateSettings(patch));

  ipcMain.handle('dialog:choose-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      defaultPath: getSettings().workingDirectory,
      filters: [
        { name: 'Mídia', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'mp3', 'wav', 'm4a', 'ogg'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('settings:choose-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: getSettings().workingDirectory,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    updateSettings({ workingDirectory: result.filePaths[0] });
    return result.filePaths[0];
  });
}

module.exports = { register };
