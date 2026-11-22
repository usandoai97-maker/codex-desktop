'use strict';

const { ipcMain } = require('electron');
const auth = require('../codexAuth');

/** Handlers IPC de autenticação (equivalente a electron/ipc/codex-auth/index.js do vídeo). */
function register() {
  ipcMain.handle('codex-auth:start', async () => {
    try {
      return await auth.startAuthFlow();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('codex-auth:get-status', async () => auth.getAuthStatus());

  ipcMain.handle('codex-auth:get-token', async () => auth.getValidAccessToken());

  ipcMain.handle('codex-auth:logout', async () => auth.logout());
}

module.exports = { register };
