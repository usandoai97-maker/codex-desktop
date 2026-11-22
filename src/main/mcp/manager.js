'use strict';

/**
 * Cliente MCP (Model Context Protocol) — conecta a servidores locais via stdio
 * e expõe as ferramentas deles ao agente no modo Codex.
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { getSettings } = require('../settings');

const connections = new Map(); // id -> { client, transport, name, tools, status, error }

function prefix(serverId, toolName) {
  return `mcp_${String(serverId).replace(/[^a-zA-Z0-9_]/g, '_')}__${toolName}`;
}

async function connectServer(server) {
  if (!server.command) throw new Error('Comando do servidor não informado.');
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args || [],
    cwd: server.cwd || undefined,
    env: { ...process.env, ...(server.env || {}) },
    stderr: 'inherit',
  });
  const client = new Client({ name: 'codex-desktop', version: '1.0.0' });
  await client.connect(transport);
  const listed = await client.listTools();
  connections.set(server.id, {
    client,
    transport,
    name: server.name || server.id,
    tools: listed.tools || [],
    status: 'connected',
    error: null,
  });
}

async function disconnect(id) {
  const conn = connections.get(id);
  if (!conn) return;
  try { await conn.client.close(); } catch { /* ignore */ }
  try { await conn.transport.close(); } catch { /* ignore */ }
  connections.delete(id);
}

async function disconnectAll() {
  for (const id of Array.from(connections.keys())) await disconnect(id);
}

async function refresh() {
  const servers = getSettings().mcpServers || [];
  const desired = new Set(servers.filter((s) => s.enabled !== false).map((s) => s.id));

  for (const id of Array.from(connections.keys())) {
    if (!desired.has(id)) await disconnect(id);
  }

  for (const server of servers) {
    if (server.enabled === false) continue;
    if (connections.has(server.id) && connections.get(server.id).status === 'connected') continue;
    try {
      await connectServer(server);
    } catch (err) {
      connections.set(server.id, {
        name: server.name || server.id,
        tools: [], status: 'error', error: err.message,
      });
    }
  }
  return status();
}

function status() {
  return Array.from(connections.entries()).map(([id, c]) => ({
    id,
    name: c.name,
    status: c.status,
    error: c.error,
    tools: c.tools.map((t) => ({
      name: t.name,
      description: t.description || '',
      exposedAs: prefix(id, t.name),
    })),
  }));
}

/** Remove metadados e encurta descrições dos schemas (mantém type/properties/required). */
function compactSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} };
  const props = {};
  for (const [key, value] of Object.entries(schema.properties || {})) {
    if (!value || typeof value !== 'object') continue;
    const p = { type: value.type || 'string' };
    if (value.description) p.description = String(value.description).slice(0, 160);
    if (Array.isArray(value.enum)) p.enum = value.enum;
    if (value.items && typeof value.items === 'object') p.items = { type: value.items.type || 'string' };
    props[key] = p;
  }
  return {
    type: 'object',
    properties: props,
    required: Array.isArray(schema.required) ? schema.required : [],
  };
}

/** Ferramentas MCP no formato de function tool da Responses API. */
function definitions() {
  const defs = [];
  for (const [id, conn] of connections) {
    if (conn.status !== 'connected') continue;
    for (const t of conn.tools) {
      const desc = String(t.description || t.name);
      defs.push({
        type: 'function',
        name: prefix(id, t.name),
        description: `[MCP:${conn.name}] ${desc.slice(0, 300)}`,
        parameters: compactSchema(t.inputSchema),
      });
    }
  }
  return defs;
}

function summary() {
  const list = [];
  for (const [id, conn] of connections) {
    if (conn.status !== 'connected') continue;
    for (const t of conn.tools) {
      list.push({
        name: prefix(id, t.name),
        category: `MCP:${conn.name}`,
        description: t.description || t.name,
        dangerous: false,
        mcp: true,
        serverId: id,
        originalName: t.name,
      });
    }
  }
  return list;
}

function isMcpTool(name) {
  for (const [id, conn] of connections) {
    if (name.startsWith(`mcp_${String(id).replace(/[^a-zA-Z0-9_]/g, '_')}__`)) {
      return { id, conn };
    }
  }
  return null;
}

async function callTool(name, args = {}) {
  const found = isMcpTool(name);
  if (!found) throw new Error('Servidor MCP não encontrado para ' + name);
  if (found.conn.status !== 'connected') throw new Error('Servidor MCP desconectado: ' + found.conn.name);
  const original = name.slice(name.indexOf('__') + 2);
  const result = await found.conn.client.callTool({ name: original, arguments: args });
  return result;
}

module.exports = { refresh, status, definitions, summary, callTool, disconnect, disconnectAll, isMcpTool };
