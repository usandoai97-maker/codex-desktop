'use strict';

/**
 * Registro de ferramentas locais — o "saber mexer na máquina" do agente.
 * Cada ferramenta tem uma definição (enviada ao modelo como function tool)
 * e uma implementação executada no main process.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exec, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { shell, app } = require('electron');
const { getSettings, updateSettings } = require('../settings');
const { requestPermission } = require('../permissions');
const { runExtract } = require('./extract');
const mcp = require('../mcp/manager');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const MAX_CHARS = 24000;

function resolvePath(p) {
  if (!p) return getSettings().workingDirectory;
  return path.isAbsolute(p) ? p : path.resolve(getSettings().workingDirectory, p);
}

function clip(text) {
  const s = String(text ?? '');
  return s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) + `\n… [truncado, ${s.length} caracteres]` : s;
}

const BLOCKED = [/rm\s+-rf\s+[\/\\]$/i, /format\s+[c-d]:/i, /del\s+\/f\s+\/s\s+\/q\s+[c-d]:\\/i, /shutdown\s+\/s/i];

const TOOLS = [
  {
    name: 'get_system_info',
    category: 'Sistema',
    description: 'Retorna informações da máquina: sistema operacional, CPU, memória, disco, diretório de trabalho e versões.',
    parameters: { type: 'object', properties: {}, required: [] },
    dangerous: false,
    run: async () => {
      const s = getSettings();
      let disk = null;
      try {
        const { stdout } = await execAsync('wmic logicaldisk get size,freespace,caption', { windowsHide: true });
        disk = stdout.trim().split('\n').slice(0, 6).join('\n');
      } catch { disk = 'indisponível'; }
      return {
        platform: process.platform,
        arch: process.arch,
        os: os.type() + ' ' + os.release(),
        cpu: os.cpus()[0]?.model,
        cpuCores: os.cpus().length,
        totalMemoryGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
        freeMemoryGB: +(os.freemem() / 1024 ** 3).toFixed(1),
        home: os.homedir(),
        workingDirectory: s.workingDirectory,
        electron: process.versions.electron,
        node: process.versions.node,
        disk,
      };
    },
  },
  {
    name: 'list_directory',
    category: 'Arquivos',
    description: 'Lista arquivos e pastas de um diretório (padrão: diretório de trabalho).',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Caminho do diretório' } } },
    dangerous: false,
    run: async ({ path: p }) => {
      const dir = resolvePath(p);
      const items = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 300);
      return {
        path: dir,
        items: items.map((i) => ({
          name: i.name,
          type: i.isDirectory() ? 'dir' : i.isFile() ? 'file' : 'other',
          size: i.isFile() ? fs.statSync(path.join(dir, i.name)).size : null,
        })),
      };
    },
  },
  {
    name: 'read_file',
    category: 'Arquivos',
    description: 'Lê o conteúdo de um arquivo de texto (limitado a ~24 mil caracteres).',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    dangerous: false,
    run: async ({ path: p }) => {
      const file = resolvePath(p);
      const content = fs.readFileSync(file, 'utf8');
      return { path: file, bytes: Buffer.byteLength(content), content: clip(content) };
    },
  },
  {
    name: 'write_file',
    category: 'Arquivos',
    description: 'Cria ou sobrescreve um arquivo de texto no disco.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    dangerous: true,
    run: async ({ path: p, content }) => {
      const cfg = getSettings();
      if (!cfg.allowWrite && !cfg.fullAccess) throw new Error('Escrita de arquivos desabilitada nas configurações.');
      const file = resolvePath(p);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
      return { path: file, bytes: Buffer.byteLength(content), written: true };
    },
  },
  {
    name: 'run_command',
    category: 'Sistema',
    description: 'Executa um comando no PowerShell/cmd do Windows (timeout 40s). Use com cuidado.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Comando a executar' },
        cwd: { type: 'string', description: 'Diretório de execução (opcional)' },
      },
      required: ['command'],
    },
    dangerous: true,
    run: async ({ command, cwd }) => {
      const cfg = getSettings();
      if (!cfg.allowShell && !cfg.fullAccess) throw new Error('Execução de comandos desabilitada nas configurações.');
      if (BLOCKED.some((r) => r.test(command))) throw new Error('Comando bloqueado por segurança.');
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwd ? resolvePath(cwd) : getSettings().workingDirectory,
        timeout: 40000,
        maxBuffer: 3 * 1024 * 1024,
        windowsHide: true,
        shell: process.env.ComSpec || 'cmd.exe',
      });
      return { command, stdout: clip(stdout), stderr: clip(stderr) };
    },
  },
  {
    name: 'search_files',
    category: 'Arquivos',
    description: 'Busca arquivos pelo nome dentro de um diretório (até 200 resultados).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto ou regex do nome' },
        path: { type: 'string' },
      },
      required: ['query'],
    },
    dangerous: false,
    run: async ({ query, path: p }) => {
      const root = resolvePath(p);
      const re = new RegExp(query, 'i');
      const results = [];
      function walk(dir, depth) {
        if (depth > 6 || results.length >= 200) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const full = path.join(dir, entry.name);
          if (re.test(entry.name)) results.push(full);
          if (entry.isDirectory()) walk(full, depth + 1);
        }
      }
      walk(root, 0);
      return { root, count: results.length, results };
    },
  },
  {
    name: 'fetch_url',
    category: 'Web',
    description: 'Busca uma URL e retorna o texto da página (tags removidas, limitado).',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    dangerous: false,
    run: async ({ url }) => {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 CodexDesktop/1.0' } });
      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ').trim();
      return { url, status: res.status, text: clip(text) };
    },
  },
  {
    name: 'open_path',
    category: 'Sistema',
    description: 'Abre um arquivo ou pasta no Explorador do Windows.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    dangerous: false,
    run: async ({ path: p }) => {
      const target = resolvePath(p);
      const result = await shell.openPath(target);
      return { path: target, opened: result === '', error: result || null };
    },
  },
  {
    name: 'extract_video_info',
    category: 'Extração',
    description: 'Retorna duração, resolução, FPS e presença de áudio de um vídeo.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    dangerous: false,
    run: async ({ path: p }) => runExtract('info', [resolvePath(p)]),
  },
  {
    name: 'extract_audio',
    category: 'Extração',
    description: 'Extrai o áudio de um vídeo para MP3.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, output: { type: 'string' } },
      required: ['path'],
    },
    dangerous: false,
    run: async ({ path: p, output }) => runExtract('audio', [resolvePath(p), output ? resolvePath(output) : undefined]),
  },
  {
    name: 'extract_frames',
    category: 'Extração',
    description: 'Extrai quadros de um vídeo a cada N segundos.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        interval: { type: 'integer', description: 'Segundos entre quadros' },
        folder: { type: 'string' },
      },
      required: ['path'],
    },
    dangerous: false,
    run: async ({ path: p, interval, folder }) =>
      runExtract('frames', [resolvePath(p), interval || 60, folder ? resolvePath(folder) : undefined]),
  },
  {
    name: 'make_contact_sheet',
    category: 'Extração',
    description: 'Monta uma folha de contato a partir dos quadros extraídos.',
    parameters: {
      type: 'object',
      properties: { folder: { type: 'string' }, cols: { type: 'integer' }, rows: { type: 'integer' } },
      required: ['folder'],
    },
    dangerous: false,
    run: async ({ folder, cols, rows }) =>
      runExtract('contact', [resolvePath(folder), cols || 3, rows || 6]),
  },
  {
    name: 'transcribe_audio',
    category: 'Extração',
    description: 'Transcreve um arquivo de áudio com Whisper (pt, en ou auto).',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, language: { type: 'string' } },
      required: ['path'],
    },
    dangerous: false,
    run: async ({ path: p, language }) =>
      runExtract('transcribe', [resolvePath(p), language || 'pt']),
  },
  {
    name: 'run_powershell',
    category: 'Sistema',
    description: 'Executa um comando PowerShell (sem perfil, timeout 40s). Ideal para administrar o Windows.',
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    dangerous: true,
    run: async ({ command }) => {
      const cfg = getSettings();
      if (!cfg.allowShell && !cfg.fullAccess) throw new Error('Execução de comandos desabilitada nas configurações.');
      if (BLOCKED.some((r) => r.test(command))) throw new Error('Comando bloqueado por segurança.');
      const { stdout, stderr } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { timeout: 40000, maxBuffer: 3 * 1024 * 1024, windowsHide: true }
      );
      return { command, stdout: clip(stdout), stderr: clip(stderr) };
    },
  },
  {
    name: 'create_directory',
    category: 'Arquivos',
    description: 'Cria uma pasta (inclusive pastas intermediárias).',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    dangerous: false,
    run: async ({ path: p }) => {
      const dir = resolvePath(p);
      fs.mkdirSync(dir, { recursive: true });
      return { path: dir, created: true };
    },
  },
  {
    name: 'copy_file',
    category: 'Arquivos',
    description: 'Copia um arquivo para outro caminho.',
    parameters: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
    dangerous: false,
    run: async ({ from, to }) => {
      const src = resolvePath(from), dst = resolvePath(to);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      return { from: src, to: dst, copied: true };
    },
  },
  {
    name: 'move_file',
    category: 'Arquivos',
    description: 'Move ou renomeia um arquivo/pasta.',
    parameters: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
    dangerous: true,
    run: async ({ from, to }) => {
      const src = resolvePath(from), dst = resolvePath(to);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(src, dst);
      return { from: src, to: dst, moved: true };
    },
  },
  {
    name: 'delete_file',
    category: 'Arquivos',
    description: 'Remove um arquivo.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    dangerous: true,
    run: async ({ path: p }) => {
      const file = resolvePath(p);
      fs.unlinkSync(file);
      return { path: file, deleted: true };
    },
  },
  {
    name: 'list_processes',
    category: 'Sistema',
    description: 'Lista os processos em execução (nome, PID, uso de memória).',
    parameters: { type: 'object', properties: {}, required: [] },
    dangerous: false,
    run: async () => {
      const { stdout } = await execAsync('tasklist /FO CSV /NH', { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      const lines = stdout.trim().split('\n').slice(0, 60);
      const processes = lines.map((line) => line.replace(/"/g, '').split(',')).map((p) => ({
        name: p[0], pid: p[1], memory: p[3] || p[4],
      }));
      return { count: processes.length, processes };
    },
  },
  {
    name: 'kill_process',
    category: 'Sistema',
    description: 'Encerra um processo pelo PID.',
    parameters: { type: 'object', properties: { pid: { type: 'integer' } }, required: ['pid'] },
    dangerous: true,
    run: async ({ pid }) => {
      if (!/^\d+$/.test(String(pid))) throw new Error('PID inválido.');
      const { stdout, stderr } = await execAsync(`taskkill /PID ${pid} /F`, { windowsHide: true });
      return { pid, stdout: clip(stdout), stderr: clip(stderr) };
    },
  },
  {
    name: 'open_url',
    category: 'Web',
    description: 'Abre uma URL no navegador padrão.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    dangerous: false,
    run: async ({ url }) => {
      await shell.openExternal(url);
      return { url, opened: true };
    },
  },
  {
    name: 'get_clipboard',
    category: 'Sistema',
    description: 'Lê o conteúdo da área de transferência do Windows.',
    parameters: { type: 'object', properties: {}, required: [] },
    dangerous: false,
    run: async () => {
      const { stdout } = await execFileAsync('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'],
        { windowsHide: true, timeout: 15000 });
      return { text: clip(stdout) };
    },
  },
  {
    name: 'set_clipboard',
    category: 'Sistema',
    description: 'Copia um texto para a área de transferência do Windows.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    dangerous: false,
    run: async ({ text }) => {
      const { stdout } = await execFileAsync('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -Value $args[0]', text],
        { windowsHide: true, timeout: 15000 });
      return { copied: true, stdout: clip(stdout) };
    },
  },

  /* ---- Gerenciamento de MCP direto pelo chat ---- */
  {
    name: 'mcp_connect',
    category: 'MCP',
    description: 'Adiciona e conecta servidores MCP em tempo real. Aceita {"mcpServers":{...}} (vários) ou um objeto de servidor com name/command/args. Após conectar, as ferramentas do servidor ficam disponíveis imediatamente na próxima rodada.',
    parameters: {
      type: 'object',
      properties: {
        config: { type: 'object', description: 'Configuração MCP no formato {mcpServers:{...}} ou {name,command,args}' },
      },
      required: ['config'],
    },
    dangerous: false,
    run: async ({ config }) => {
      if (!config || typeof config !== 'object') throw new Error('Config inválida.');

      const normalizeId = (s) => String(s || 'mcp').toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const incoming = [];

      const rawServers = config.mcpServers || config.servers;
      if (rawServers) {
        if (Array.isArray(rawServers)) {
          for (const s of rawServers) incoming.push(s);
        } else if (typeof rawServers === 'object') {
          for (const [name, cfg] of Object.entries(rawServers)) {
            incoming.push({ id: normalizeId(name), name, ...cfg });
          }
        }
      } else if (config.command) {
        incoming.push({
          id: normalizeId(config.name || config.id),
          name: config.name || config.id || 'MCP',
          command: config.command,
          args: config.args || [],
          cwd: config.cwd || '',
          env: config.env || {},
        });
      }

      if (!incoming.length) throw new Error('Nenhum servidor encontrado na configuração.');

      const servers = [...(getSettings().mcpServers || [])];
      for (const s of incoming) {
        const id = s.id || normalizeId(s.name);
        const entry = {
          id,
          name: s.name || id,
          command: s.command || '',
          args: Array.isArray(s.args) ? s.args : (s.args ? [s.args] : []),
          cwd: s.cwd || '',
          env: s.env || {},
          enabled: s.enabled !== false,
        };
        const idx = servers.findIndex((x) => x.id === id);
        if (idx >= 0) servers[idx] = entry; else servers.push(entry);
      }

      updateSettings({ mcpServers: servers });
      const status = await mcp.refresh();
      return {
        connected: true,
        added: incoming.map((s) => s.name || s.id),
        status,
        message: 'Servidores conectados. As ferramentas MCP já estão disponíveis na próxima rodada.',
      };
    },
  },
  {
    name: 'mcp_status',
    category: 'MCP',
    description: 'Lista servidores MCP configurados, status e ferramentas expostas.',
    parameters: { type: 'object', properties: {}, required: [] },
    dangerous: false,
    run: async () => ({
      servers: mcp.status(),
      definitions: mcp.definitions().map((d) => d.name),
    }),
  },
  {
    name: 'mcp_disconnect',
    category: 'MCP',
    description: 'Remove/desconecta um servidor MCP pelo nome ou id.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    dangerous: false,
    run: async ({ name }) => {
      const key = String(name || '').toLowerCase();
      const servers = (getSettings().mcpServers || []).filter((s) =>
        s.id !== name && s.name?.toLowerCase() !== key && s.id?.toLowerCase() !== key);
      updateSettings({ mcpServers: servers });
      await mcp.refresh();
      return { removed: name, servers };
    },
  },
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));
const history = require('../history');

function getHistory() { return history.list().slice(0, 50); }

/** Definições no formato "function tool" da Responses API. */
function definitions() {
  const local = TOOLS.map((t) => ({
    type: 'function',
    name: t.name,
    description: `${t.description} Categoria: ${t.category}.`,
    parameters: t.parameters,
  }));
  return [...local, ...mcp.definitions()];
}

function summary() {
  const local = TOOLS.map((t) => ({
    name: t.name,
    category: t.category,
    description: t.description,
    dangerous: t.dangerous,
  }));
  return [...local, ...mcp.summary()];
}

async function invoke(name, args = {}) {
  const started = Date.now();
  const finish = (outcome) => {
    history.add({ type: 'tool', name, args, ok: outcome.ok, ms: outcome.ms, result: outcome });
    return outcome;
  };

  if (mcp.isMcpTool(name)) {
    try {
      const result = await mcp.callTool(name, args);
      return finish({ ok: true, tool: name, ms: Date.now() - started, result, mcp: true });
    } catch (err) {
      return finish({ ok: false, tool: name, ms: Date.now() - started, error: err.message, mcp: true });
    }
  }

  const tool = byName.get(name);
  if (!tool) return finish({ ok: false, error: `Ferramenta desconhecida: ${name}` });

  if (tool.dangerous) {
    const allowed = await requestPermission(name, args, tool.description);
    if (!allowed) return finish({ ok: false, error: 'Usuário negou a execução desta ferramenta.' });
  }

  try {
    const result = await tool.run(args || {});
    return finish({ ok: true, tool: name, ms: Date.now() - started, result });
  } catch (err) {
    return finish({ ok: false, tool: name, ms: Date.now() - started, error: err.message });
  }
}

module.exports = { definitions, summary, invoke, getHistory, TOOLS };
