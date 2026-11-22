'use strict';

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const codexAuthIpc = require('./ipc/codexAuth');
const codexApiIpc = require('./ipc/codexApi');
const toolsIpc = require('./ipc/tools');
const mcpIpc = require('./ipc/mcp');
const usageIpc = require('./ipc/usage');
const convIpc = require('./ipc/conversations');
const mcp = require('./mcp/manager');
const permissions = require('./permissions');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Codex Desktop — Agente Local',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function sendAction(action) {
  if (mainWindow) mainWindow.webContents.send('menu:action', action);
}

function buildMenu() {
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Nova conversa', accelerator: 'CmdOrCtrl+N', click: () => sendAction('new-chat') },
        { label: 'Conversas antigas…', accelerator: 'CmdOrCtrl+O', click: () => sendAction('view-conversations') },
        { label: 'Escolher pasta de trabalho…', click: () => sendAction('choose-folder') },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Ferramentas',
      submenu: [
        { label: 'Ver ferramentas', click: () => sendAction('view-tools') },
        { label: 'Histórico de execuções', click: () => sendAction('view-history') },
        { label: 'Uso e limites', click: () => sendAction('view-usage') },
        { label: 'Servidores MCP…', click: () => sendAction('view-mcp') },
        { label: 'Configurações', click: () => sendAction('view-settings') },
      ],
    },
    {
      label: 'Extrair',
      submenu: [
        { label: 'Informações de vídeo…', click: () => sendAction('extract-info') },
        { label: 'Áudio de vídeo…', click: () => sendAction('extract-audio') },
        { label: 'Quadros de vídeo…', click: () => sendAction('extract-frames') },
        { label: 'Transcrever áudio…', click: () => sendAction('transcribe') },
        { type: 'separator' },
        { label: 'Abrir painel de extração', click: () => sendAction('view-extract') },
      ],
    },
    {
      label: 'Visualizar',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'toggleDevTools', label: 'DevTools' },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Aumentar zoom' },
        { role: 'zoomOut', label: 'Diminuir zoom' },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        { label: 'Documentação', click: () => shell.openExternal(path.join(__dirname, '..', '..', 'README.md')) },
        { label: 'Sobre', click: () => sendAction('about') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  codexAuthIpc.register();
  codexApiIpc.register();
  toolsIpc.register();
  mcpIpc.register();
  usageIpc.register();
  convIpc.register();
  permissions.register();
  mcp.refresh().catch((err) => console.error('[mcp] refresh inicial falhou:', err.message));
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
