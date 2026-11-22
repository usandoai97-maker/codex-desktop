'use strict';

const { BrowserWindow, ipcMain } = require('electron');
const { getSettings } = require('./settings');

const pending = new Map();
let counter = 0;

/** Main → Renderer: pede autorização ao usuário e espera a resposta. */
function requestPermission(toolName, args, reason) {
  if (!getSettings().askConfirmation) return Promise.resolve(true);

  return new Promise((resolve) => {
    const id = `perm-${++counter}`;
    pending.set(id, resolve);
    const windows = BrowserWindow.getAllWindows();
    if (!windows.length) {
      pending.delete(id);
      resolve(false);
      return;
    }
    windows[0].webContents.send('tool:permission-request', { id, toolName, args, reason });
    // Se o usuário ignorar, não travamos para sempre.
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve(false);
      }
    }, 120000);
  });
}

function register() {
  ipcMain.handle('tool:permission-response', (_event, { id, allowed }) => {
    const resolve = pending.get(id);
    if (resolve) {
      pending.delete(id);
      resolve(!!allowed);
    }
    return { ok: true };
  });

  ipcMain.handle('tool:permission-pending', () => Array.from(pending.keys()));
}

module.exports = { requestPermission, register };
