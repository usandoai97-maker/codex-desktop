'use strict';

/** Testes das ferramentas locais com "electron" mockado. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-tools-'));
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') {
    return {
      app: { getPath: () => path.join(TMP, 'userData'), isPackaged: false },
      safeStorage: { isEncryptionAvailable: () => false },
      shell: { openExternal: async () => {}, openPath: async () => '' },
      ipcMain: { handle: () => {} },
      BrowserWindow: { getAllWindows: () => [] },
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    };
  }
  return originalLoad.apply(this, arguments);
};

// Stub do gerenciador MCP para não spawnar processos reais nos testes
const mcpPath = require.resolve('../src/main/mcp/manager');
require.cache[mcpPath] = {
  id: mcpPath, filename: mcpPath, loaded: true,
  exports: {
    definitions: () => [], summary: () => [], status: () => [],
    isMcpTool: () => null, callTool: async () => ({}),
    refresh: async () => [], disconnect: async () => {},
  },
};

const tools = require('../src/main/tools');
const { updateSettings, getSettings } = require('../src/main/settings');

(async () => {
  const summary = tools.summary();
  assert.ok(summary.length >= 13, 'deve haver pelo menos 13 ferramentas');
  assert.ok(summary.some((t) => t.name === 'extract_audio'));
  assert.ok(summary.some((t) => t.name === 'run_command' && t.dangerous));
  assert.equal(tools.definitions().length, summary.length);
  console.log(`✓ ${summary.length} ferramentas registradas e enviáveis ao modelo`);

  // Sem confirmação para os testes
  updateSettings({ workingDirectory: TMP, askConfirmation: false, allowShell: true, allowWrite: true });

  const sys = await tools.invoke('get_system_info', {});
  assert.equal(sys.ok, true);
  assert.ok(sys.result.platform);
  console.log('✓ get_system_info');

  const write = await tools.invoke('write_file', { path: 'teste.txt', content: 'olá ferramentas' });
  assert.equal(write.ok, true);
  const read = await tools.invoke('read_file', { path: 'teste.txt' });
  assert.equal(read.result.content, 'olá ferramentas');
  console.log('✓ write_file + read_file');

  const list = await tools.invoke('list_directory', {});
  assert.ok(list.result.items.some((i) => i.name === 'teste.txt'));
  console.log('✓ list_directory');

  const search = await tools.invoke('search_files', { query: 'teste\\.txt' });
  assert.ok(search.result.count >= 1);
  console.log('✓ search_files');

  const cmd = await tools.invoke('run_command', { command: 'echo OK_TOOLS' });
  assert.equal(cmd.ok, true);
  assert.ok(cmd.result.stdout.includes('OK_TOOLS'));
  console.log('✓ run_command');

  const unknown = await tools.invoke('nao_existe', {});
  assert.equal(unknown.ok, false);
  console.log('✓ ferramenta inexistente tratada');

  // Full Access ignora flags e confirmação
  updateSettings({ askConfirmation: true, allowShell: false, allowWrite: false, fullAccess: true });
  const faCmd = await tools.invoke('run_command', { command: 'echo FULL_ACCESS_OK' });
  assert.equal(faCmd.ok, true);
  assert.ok(faCmd.result.stdout.includes('FULL_ACCESS_OK'));
  const faWrite = await tools.invoke('write_file', { path: 'full.txt', content: 'ok' });
  assert.equal(faWrite.ok, true);
  console.log('✓ full access executa comandos/escrita sem confirmação');

  updateSettings({ fullAccess: false });

  // MCP conectado pelo chat (formato {mcpServers:{...}})
  const mcpResult = await tools.invoke('mcp_connect', {
    config: {
      mcpServers: {
        Roblox_Studio: {
          command: 'cmd.exe',
          args: ['/c', 'cd /d %LOCALAPPDATA%\\Roblox && .\\mcp.bat'],
        },
      },
    },
  });
  assert.equal(mcpResult.ok, true);
  assert.deepEqual(mcpResult.result.added, ['Roblox_Studio']);
  assert.equal(getSettings().mcpServers.length, 1);
  assert.equal(getSettings().mcpServers[0].command, 'cmd.exe');
  console.log('✓ MCP conectado pelo chat no formato {mcpServers:{...}}');

  const mcpStatus = await tools.invoke('mcp_status', {});
  assert.equal(mcpStatus.ok, true);
  console.log('✓ mcp_status disponível');

  const hist = tools.getHistory();
  assert.ok(hist.length >= 6, 'todas as invocações devem ser registradas');
  assert.ok(hist.some((h) => h.name === 'run_command'));
  assert.ok(hist.some((h) => h.name === 'nao_existe' && h.result.ok === false));
  console.log(`✓ histórico registra todas as chamadas (${hist.length} entradas)`);

  console.log('\nTODOS OS TESTES PASSARAM');
  process.exit(0);
})().catch((err) => { console.error('FALHA:', err); process.exit(1); });
