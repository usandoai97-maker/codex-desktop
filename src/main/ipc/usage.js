'use strict';

const { ipcMain } = require('electron');
const usage = require('../usage');
const fiveHour = require('../fiveHour');

function register() {
  ipcMain.handle('usage:local5h', () => fiveHour.status());
  ipcMain.handle('usage:get', async () => {
    const fresh = await usage.fetchUsage();
    const cached = usage.getCached();
    return fresh?.ok ? fresh : (cached || fresh);
  });

  ipcMain.handle('usage:cached', () => usage.getCached());

  ipcMain.handle('usage:open-settings', async () => {
    const { shell } = require('electron');
    await shell.openExternal(usage.SETTINGS_URL);
    return { opened: true };
  });
}

module.exports = { register };
