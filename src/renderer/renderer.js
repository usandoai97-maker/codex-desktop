'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  statusText: $('statusText'), loginBtn: $('loginBtn'), logoutBtn: $('logoutBtn'),
  loginBtn2: $('loginBtn2'), authError: $('authError'), loginGate: $('loginGate'),
  model: $('model'), reloadModelsBtn: $('reloadModelsBtn'), effort: $('effort'),
  fullAccessBtn: $('fullAccessBtn'),
  messages: $('messages'), prompt: $('prompt'), sendBtn: $('sendBtn'), chatError: $('chatError'),
  activity: $('toolActivity'),
  toolsGrid: $('toolsGrid'), toolSelect: $('toolSelect'), toolArgs: $('toolArgs'),
  toolRunBtn: $('toolRunBtn'), toolOutput: $('toolOutput'), toolCount: $('toolCount'),
  extractPath: $('extractPath'), pickExtractFile: $('pickExtractFile'),
  frameInterval: $('frameInterval'), transcriptLang: $('transcriptLang'), extractOutput: $('extractOutput'),
  systemInfo: $('systemInfo'), refreshSystem: $('refreshSystem'),
  commandInput: $('commandInput'), runCommandBtn: $('runCommandBtn'), commandOutput: $('commandOutput'),
  historyList: $('historyList'), refreshHistory: $('refreshHistory'), clearHistory: $('clearHistory'),
  cfgWorkingDir: $('cfgWorkingDir'), cfgAllowShell: $('cfgAllowShell'), cfgAllowWrite: $('cfgAllowWrite'),
  cfgAskConfirm: $('cfgAskConfirm'), cfgPython: $('cfgPython'), cfgRounds: $('cfgRounds'),
  cfgEffort: $('cfgEffort'), cfgFullAccess: $('cfgFullAccess'),
  cfgPickDir: $('cfgPickDir'), saveSettings: $('saveSettings'), settingsMsg: $('settingsMsg'),
  permissionModal: $('permissionModal'), permissionInfo: $('permissionInfo'),
  permAllow: $('permAllow'), permDeny: $('permDeny'),
  modeSwitch: $('modeSwitch'),
  mcpName: $('mcpName'), mcpCommand: $('mcpCommand'), mcpArgs: $('mcpArgs'),
  mcpCwd: $('mcpCwd'), addMcpBtn: $('addMcpBtn'), mcpMsg: $('mcpMsg'),
  mcpStatus: $('mcpStatus'), refreshMcp: $('refreshMcp'),
  conversationsList: $('conversationsList'), newConvBtn: $('newConvBtn'),
  usageBox: $('usageBox'), usageMsg: $('usageMsg'),
  refreshUsage: $('refreshUsage'), openUsageSettings: $('openUsageSettings'),
};

const FALLBACK_MODELS = ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.5'];
const chatHistory = [];
let busy = false;
let currentPermission = null;
let toolCache = [];
let currentMode = 'chat';
let activeConvId = null;
let fullAccess = false;

/* ---------------- utilidades ---------------- */

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  els.messages.appendChild(div);
  els.messages.scrollTop = els.messages.scrollHeight;
  return div;
}

function logActivity(text, isError) {
  const div = document.createElement('div');
  if (isError) div.className = 'err';
  div.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  els.activity.appendChild(div);
  els.activity.scrollTop = els.activity.scrollHeight;
}

let usageTimer = null;

function setView(name) {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  if (usageTimer) { clearInterval(usageTimer); usageTimer = null; }
  if (name === 'usage') usageTimer = setInterval(loadUsage, 60000);
  if (name === 'history') usageTimer = setInterval(loadHistory, 4000);
}

/* ---------------- modos Chat / Codex ---------------- */

function applyModeUI(mode) {
  currentMode = mode;
  els.modeSwitch.querySelectorAll('button').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode));
  document.body.dataset.mode = mode;
  const sub = document.querySelector('#view-chat .sub');
  if (sub) sub.textContent = mode === 'codex'
    ? 'MODO CODEX — acesso total: PowerShell, arquivos, pastas, processos e MCP.'
    : 'MODO CHAT — conversa sem acesso à máquina. Mude para Codex para usar ferramentas.';
}

function applyFullAccessUI(enabled) {
  fullAccess = !!enabled;
  els.fullAccessBtn.textContent = fullAccess ? '🔓 Full: ON' : '🔒 Full: OFF';
  els.fullAccessBtn.classList.toggle('full-on', fullAccess);
  els.fullAccessBtn.classList.toggle('full-off', !fullAccess);
  if (els.cfgFullAccess) els.cfgFullAccess.checked = fullAccess;
  const sub = document.querySelector('#view-chat .sub');
  if (sub && currentMode === 'codex') {
    sub.textContent = fullAccess
      ? '⚡ MODO CODEX + 🔓 FULL ACCESS — sem pedir permissão para nada.'
      : 'MODO CODEX — acesso total: PowerShell, arquivos, pastas, processos e MCP.';
  }
}

async function toggleFullAccess() {
  const next = !fullAccess;
  if (next) {
    const ok = confirm('FULL ACCESS: o agente não pedirá permissão para executar comandos, escrever/excluir arquivos, matar processos etc.\n\nUse apenas se você confia nas instruções que vai dar. Ativar?');
    if (!ok) return;
  }
  applyFullAccessUI(next);
  await window.electronAPI.settings.set({ fullAccess: next });
  logActivity(`Full Access: ${next ? 'ATIVADO (sem confirmações)' : 'desativado'}`);
}

async function setMode(mode) {
  applyModeUI(mode);
  await window.electronAPI.settings.set({ mode });
  logActivity(`Modo alterado para ${mode.toUpperCase()}`);
  if (mode === 'codex') await loadTools();
}

/* ---------------- MCP ---------------- */

async function loadMcp() {
  let status;
  try { status = await window.electronAPI.mcp.status(); }
  catch (err) { els.mcpStatus.innerHTML = `<div class="bad">Erro: ${err.message}</div>`; return; }

  els.mcpStatus.innerHTML = '';
  if (!status.length) {
    els.mcpStatus.innerHTML = '<div>Nenhum servidor MCP configurado. Adicione um acima.</div>';
    return;
  }
  for (const s of status) {
    const div = document.createElement('div');
    const ok = s.status === 'connected';
    const tools = s.tools.map((t) => `<span class="tool">${t.exposedAs}</span>`).join('');
    div.innerHTML = `<strong>${s.name}</strong> · <span class="${ok ? 'ok' : 'bad'}">${s.status}</span>
      ${s.error ? `<div class="bad">${s.error}</div>` : ''}
      <div><code>ID: ${s.id}</code></div>
      <div>${tools || '<span class="tool">sem ferramentas</span>'}</div>
      <div class="button-row">
        <button class="btn ghost small" data-mcp-toggle="${s.id}">${s.status === 'connected' ? 'Desconectar' : 'Conectar'}</button>
        <button class="btn ghost small" data-mcp-remove="${s.id}">Remover</button>
      </div>`;
    els.mcpStatus.appendChild(div);
  }
  els.mcpStatus.querySelectorAll('[data-mcp-toggle]').forEach((b) =>
    b.addEventListener('click', async () => {
      await window.electronAPI.mcp.toggleServer(b.dataset.mcpToggle);
      await loadMcp(); await loadTools();
    }));
  els.mcpStatus.querySelectorAll('[data-mcp-remove]').forEach((b) =>
    b.addEventListener('click', async () => {
      await window.electronAPI.mcp.removeServer(b.dataset.mcpRemove);
      await loadMcp(); await loadTools();
    }));
}

async function addMcpServer() {
  let args = [];
  if (els.mcpArgs.value.trim()) {
    try { args = JSON.parse(els.mcpArgs.value); }
    catch (err) { els.mcpMsg.textContent = 'Args JSON inválido: ' + err.message; return; }
  }
  await window.electronAPI.mcp.addServer({
    name: els.mcpName.value.trim() || 'servidor',
    command: els.mcpCommand.value.trim(),
    args,
    cwd: els.mcpCwd.value.trim(),
    enabled: true,
  });
  els.mcpMsg.textContent = 'Servidor salvo. Conectando…';
  await window.electronAPI.mcp.refresh();
  await loadMcp();
  await loadTools();
  els.mcpMsg.textContent = 'Pronto.';
}

/* ---------------- uso e limites ---------------- */

function fmtReset(seconds) {
  if (!seconds && seconds !== 0) return '';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `renova em ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `renova em ${m} min`;
  const h = Math.floor(m / 60);
  const date = new Date(Date.now() + s * 1000);
  return `renova em ${h}h ${m % 60} min (${date.toLocaleString()})`;
}

function windowLabel(w, fallback) {
  const sec = w?.windowSeconds;
  if (!sec) return fallback;
  const hours = sec / 3600;
  if (hours <= 6) return `Limite de ${Math.round(hours)}h`;
  const days = sec / 86400;
  if (days <= 8) return 'Limite semanal';
  return `Limite de ${Math.round(days)} dias`;
}

function limitBar(label, window) {
  if (!window) return '';
  const left = window.leftPercent;
  const cls = left <= 10 ? 'crit' : left <= 30 ? 'warn' : '';
  const note = window.resetAt
    ? new Date(window.resetAt * 1000).toLocaleString()
    : fmtReset(window.resetAfterSeconds);
  return `<div class="usage-row">
    <div class="label"><span>${esc(label)}</span><strong>${left}% livre</strong></div>
    <div class="bar ${cls}"><span class="fill" data-w="${Math.max(0, Math.min(100, left))}"></span></div>
    <div class="usage-note">${esc(note)}</div>
  </div>`;
}

function renderUsage(data) {
  if (!data || !data.ok) {
    els.usageBox.innerHTML = `<div class="error">${data?.error || 'Sem dados de uso.'}</div>`;
    return;
  }
  const d = data.defaultLimit || {};
  const additional = (data.additionalLimits || []).map((l) =>
    `<h2 class="usage-subtitle">${esc(l.name)}</h2>${limitBar('Janela curta', l.primary)}${limitBar('Janela longa', l.secondary)}`
  ).join('');
  const credits = data.credits
    ? `<p class="usage-credit">Créditos: ${data.credits.unlimited ? 'ilimitados' : (data.credits.balance ?? '—')}${
        data.credits.overageLimitReached ? ' (limite de overage atingido)' : ''}</p>`
    : '';
  els.usageBox.innerHTML = `
    <div class="usage-head">
      <span>Conta: <strong>${data.email || '—'}</strong> ${data.plan ? `· ${data.plan}` : ''}</span>
      <span>${data.source === 'headers' ? 'via headers da API' : 'via endpoint de uso'} · ${
        new Date(data.fetchedAt).toLocaleTimeString()}</span>
    </div>
    ${limitBar(windowLabel(d.primary, 'Limite de 5 horas'), d.primary)}
    ${limitBar(windowLabel(d.secondary, 'Limite semanal'), d.secondary)}
    ${additional}
    ${credits}
    <p class="usage-note">Texto simples no ChatGPT (Free/Go) pode não ser medido. Recursos avançados — Codex, ferramentas, arquivos e raciocínio HIGH/MAX — têm limites próprios. O percentual vem do backend e pode atrasar alguns minutos.</p>
    ${data.warning ? `<p class="error">${esc(data.warning)}</p>` : ''}
    <details class="usage-raw"><summary>Ver dados brutos (diagnóstico)</summary><pre>${esc(JSON.stringify(data.raw || {}, null, 2).slice(0, 20000))}</pre></details>`;
  els.usageBox.querySelectorAll('.fill').forEach((el) => {
    el.style.width = el.dataset.w + '%';
  });
}

async function loadUsage() {
  try {
    const data = await window.electronAPI.usage.get();
    renderUsage(data);
  } catch (err) {
    els.usageBox.innerHTML = `<div class="error">${err.message}</div>`;
  }
}

function showRateLimit(info) {
  const left = info.primary?.leftPercent;
  const msg = info.message || 'Limite de uso atingido.';
  const when = info.resetSeconds ? fmtReset(info.resetSeconds)
    : info.primary?.resetAfterSeconds ? fmtReset(info.primary.resetAfterSeconds) : '';
  els.chatError.textContent = `⏳ ${msg}${when ? ' · ' + when : ''}${left !== undefined ? ` · restam ${left}% no limite de 5h` : ''}`;
  logActivity(`Limite atingido: ${msg}${when ? ' — ' + when : ''}`, true);
  loadUsage();
}

function fmt(obj) {
  return typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- autenticação ---------------- */

async function refreshStatus() {
  const status = await window.electronAPI.codexAuth.getStatus();
  const authed = !!status.authenticated;
  els.statusText.textContent = authed ? `Conectado: ${status.email || status.account_id}` : 'Não autenticado';
  els.loginBtn.hidden = authed;
  els.logoutBtn.hidden = !authed;
  els.loginGate.hidden = authed;
  if (authed) await loadModels();
  return status;
}

async function loadModels() {
  let result;
  try { result = await window.electronAPI.codexApi.listModels(); }
  catch (err) { result = { error: true, message: err.message, models: FALLBACK_MODELS }; }
  const models = result.models?.length ? result.models : FALLBACK_MODELS;
  const previous = els.model.value;
  els.model.innerHTML = '';
  for (const slug of models) {
    const option = document.createElement('option');
    option.value = slug; option.textContent = slug; els.model.appendChild(option);
  }
  if (models.includes(previous)) els.model.value = previous;
  if (result.error) logActivity(`Catálogo de modelos indisponível: ${result.message || result.status}. Usando padrão.`, true);
}

async function startAuth() {
  els.authError.textContent = '';
  els.loginBtn2.disabled = true;
  els.loginBtn2.textContent = 'Aguardando navegador…';
  try {
    const result = await window.electronAPI.codexAuth.start();
    if (!result.success) throw new Error(result.error || 'Falha desconhecida');
    await refreshStatus();
  } catch (err) {
    els.authError.textContent = err.message;
  } finally {
    els.loginBtn2.disabled = false;
    els.loginBtn2.textContent = 'Iniciar autenticação';
  }
}

async function logout() {
  await window.electronAPI.codexAuth.logout();
  await refreshStatus();
}

/* ---------------- conversas salvas ---------------- */

function renderChatMessages() {
  els.messages.innerHTML = '';
  for (const msg of chatHistory) addMessage(msg.role, msg.content);
}

async function loadConversations() {
  const list = await window.electronAPI.conversations.list();
  els.conversationsList.innerHTML = '';
  if (!list || !list.length) {
    els.conversationsList.innerHTML = '<div>Nenhuma conversa salva. Crie uma nova.</div>';
    return;
  }
  for (const c of list) {
    const div = document.createElement('div');
    div.innerHTML = `<div class="conv-title">${c.active ? '● ' : ''}${esc(c.title)}</div>
      <div class="conv-meta">${new Date(c.updatedAt).toLocaleString()} · ${c.count} mensagens · ${
        esc(c.mode || 'chat')} ${c.model ? '· ' + esc(c.model) : ''}</div>
      <div class="conv-meta">${esc(c.preview || '')}</div>
      <div class="conv-actions">
        <button class="btn ghost small" data-conv-open="${c.id}">Abrir</button>
        <button class="btn ghost small" data-conv-rename="${c.id}">Renomear</button>
        ${c.active ? '' : `<button class="btn ghost small" data-conv-del="${c.id}">Excluir</button>`}
      </div>`;
    els.conversationsList.appendChild(div);
  }
  els.conversationsList.querySelectorAll('[data-conv-open]').forEach((b) =>
    b.addEventListener('click', () => openConversation(b.dataset.convOpen)));
  els.conversationsList.querySelectorAll('[data-conv-rename]').forEach((b) =>
    b.addEventListener('click', async () => {
      const item = list.find((x) => x.id === b.dataset.convRename);
      if (!item) return;
      const title = prompt('Novo título:', item.title);
      if (title) {
        await window.electronAPI.conversations.rename(item.id, title);
        loadConversations();
      }
    }));
  els.conversationsList.querySelectorAll('[data-conv-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Excluir esta conversa?')) return;
      await window.electronAPI.conversations.remove(b.dataset.convDel);
      await loadConversations();
    }));
}

async function openConversation(id) {
  const conv = await window.electronAPI.conversations.get(id);
  if (!conv) return;
  activeConvId = conv.id;
  await window.electronAPI.conversations.select(id);
  chatHistory.length = 0;
  for (const m of conv.messages) chatHistory.push({ role: m.role, content: m.content });
  renderChatMessages();
  setView('chat');
}

async function createConversation() {
  const conv = await window.electronAPI.conversations.create({ mode: currentMode, model: els.model.value });
  activeConvId = conv.id;
  chatHistory.length = 0;
  renderChatMessages();
  setView('chat');
  els.prompt.focus();
}

async function saveMessages(messages) {
  if (!activeConvId || !messages.length) return;
  await window.electronAPI.conversations.append(activeConvId, messages);
}

/* ---------------- chat com tool-calling ---------------- */

async function send() {
  if (busy) return;
  const text = els.prompt.value.trim();
  if (!text) return;

  busy = true;
  els.sendBtn.disabled = true;
  els.chatError.textContent = '';
  els.prompt.value = '';
  chatHistory.push({ role: 'user', content: text });
  addMessage('user', text);
  await saveMessages([{ role: 'user', content: text }]);

  const out = addMessage('assistant', '');
  let answer = '';

  const unsubscribe = window.electronAPI.codexApi.onStreamChunk((chunk) => {
    switch (chunk.type) {
      case 'text':
        answer += chunk.delta || '';
        out.textContent = answer;
        els.messages.scrollTop = els.messages.scrollHeight;
        break;
      case 'tool-call':
        logActivity(`🔧 ${chunk.name} ${JSON.stringify(chunk.args).slice(0, 180)}`);
        break;
      case 'tool-result':
        logActivity(`${chunk.ok ? '✅' : '❌'} ${chunk.name}: ${chunk.summary}`, !chunk.ok);
        break;
      case 'notice':
        logActivity(`ℹ️ ${chunk.message}`);
        break;
      case 'rate-limit':
        showRateLimit(chunk);
        break;
      case 'raw':
        answer += chunk.raw || '';
        out.textContent = answer;
        break;
    }
  });

  try {
    const result = await window.electronAPI.codexApi.sendRequest({
      mode: currentMode,
      reasoningEffort: els.effort.value,
      model: els.model.value || FALLBACK_MODELS[0],
      input: [
        { role: 'system', content: 'Você é um agente local. Use as ferramentas disponíveis para inspecionar arquivos, executar comandos e extrair dados quando solicitado. Responda em português.' },
        ...chatHistory,
      ],
    });
    if (result.error) {
      let hint = '';
      if (result.status === 400 && /model/i.test(result.message || '')) hint = ' → clique em ⟳ para recarregar modelos.';
      els.chatError.textContent = `Erro ${result.status}: ${result.message}${hint}`;
      if (!out.textContent) out.textContent = '(sem resposta)';
    } else {
      if (result.text && !answer) out.textContent = result.text;
      const responseText = answer || result.text || '';
      chatHistory.push({ role: 'assistant', content: responseText });
      await saveMessages([{ role: 'assistant', content: responseText }]);
    }
  } catch (err) {
    els.chatError.textContent = err.message;
  } finally {
    unsubscribe();
    busy = false;
    els.sendBtn.disabled = false;
  }
}

/* ---------------- ferramentas ---------------- */

async function loadTools() {
  try { toolCache = await window.electronAPI.tools.list(); }
  catch { toolCache = []; }
  els.toolsGrid.innerHTML = '';
  els.toolSelect.innerHTML = '';
  const groups = {};
  for (const t of toolCache) (groups[t.category] ||= []).push(t);

  for (const [category, list] of Object.entries(groups)) {
    for (const t of list) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<h3>${t.name}</h3><p>${t.description}</p>
        <span class="tag">${category}</span>${t.dangerous ? '<span class="tag warn">pede confirmação</span>' : ''}`;
      els.toolsGrid.appendChild(card);
      const option = document.createElement('option');
      option.value = t.name; option.textContent = `${category} · ${t.name}`;
      els.toolSelect.appendChild(option);
    }
  }
  els.toolCount.textContent = `${toolCache.length} ferramentas`;
}

async function runToolFromForm() {
  const name = els.toolSelect.value;
  if (!name) return;
  let args;
  try { args = JSON.parse(els.toolArgs.value || '{}'); }
  catch (err) { els.toolOutput.textContent = 'JSON inválido: ' + err.message; return; }
  els.toolOutput.textContent = 'Executando…';
  const result = await window.electronAPI.tools.invoke(name, args);
  els.toolOutput.textContent = fmt(result);
}

/* ---------------- extração ---------------- */

async function runExtraction(action) {
  const path = els.extractPath.value.trim();
  if (!path && action !== 'contact') {
    els.extractOutput.textContent = 'Escolha um arquivo primeiro.';
    return;
  }
  els.extractOutput.textContent = `Executando ${action}… (pode demorar na primeira vez)`;
  let result;
  try {
    switch (action) {
      case 'info': result = await window.electronAPI.tools.invoke('extract_video_info', { path }); break;
      case 'audio': result = await window.electronAPI.tools.invoke('extract_audio', { path }); break;
      case 'frames': result = await window.electronAPI.tools.invoke('extract_frames', { path, interval: Number(els.frameInterval.value) || 60 }); break;
      case 'transcribe': result = await window.electronAPI.tools.invoke('transcribe_audio', { path, language: els.transcriptLang.value || 'pt' }); break;
    }
    els.extractOutput.textContent = fmt(result);
  } catch (err) {
    els.extractOutput.textContent = 'Erro: ' + err.message;
  }
}

/* ---------------- sistema / histórico / configurações ---------------- */

async function loadSystem() {
  els.systemInfo.textContent = 'Carregando…';
  const result = await window.electronAPI.tools.invoke('get_system_info', {});
  els.systemInfo.textContent = fmt(result);
}

async function runCommandFromForm() {
  const command = els.commandInput.value.trim();
  if (!command) return;
  els.commandOutput.textContent = 'Executando…';
  const result = await window.electronAPI.tools.invoke('run_command', { command });
  els.commandOutput.textContent = fmt(result);
}

async function loadHistory() {
  const list = await window.electronAPI.tools.allHistory();
  els.historyList.innerHTML = '';
  if (!list || !list.length) {
    els.historyList.innerHTML = '<div>Nenhuma atividade ainda. Envie uma mensagem no Chat ou use uma ferramenta.</div>';
    return;
  }
  for (const item of list) {
    const isChat = item.type === 'chat';
    const icon = isChat ? '💬' : '🔧';
    const status = item.status === 'running' ? '⏳' : item.ok === true ? '✅' : item.ok === false ? '❌' : '•';
    const title = isChat
      ? `Mensagem · ${item.mode || 'chat'} · ${item.model || ''}${item.effort ? ' · ' + item.effort.toUpperCase() : ''}`
      : item.name;
    const detail = isChat
      ? (item.preview || '')
      : (item.result?.error || JSON.stringify(item.result?.result || {}));
    const div = document.createElement('div');
    div.innerHTML = `<span>${status} ${icon}</span> <code>${esc(title)}</code> · ${
      new Date(item.at).toLocaleString()} · ${item.ms || 0}ms<br>
      <span>${esc(String(detail)).slice(0, 300)}</span>`;
    els.historyList.appendChild(div);
  }
}

async function loadSettings() {
  const s = await window.electronAPI.settings.get();
  els.cfgWorkingDir.value = s.workingDirectory;
  els.cfgAllowShell.checked = s.allowShell;
  els.cfgAllowWrite.checked = s.allowWrite;
  els.cfgAskConfirm.checked = s.askConfirmation;
  els.cfgPython.value = s.pythonPath;
  els.cfgRounds.value = s.maxToolRounds;
  els.cfgEffort.value = s.reasoningEffort || 'high';
  els.effort.value = els.cfgEffort.value;
  applyFullAccessUI(s.fullAccess);
}

async function saveSettings() {
  await window.electronAPI.settings.set({
    workingDirectory: els.cfgWorkingDir.value,
    allowShell: els.cfgAllowShell.checked,
    allowWrite: els.cfgAllowWrite.checked,
    askConfirmation: els.cfgAskConfirm.checked,
    pythonPath: els.cfgPython.value,
    maxToolRounds: Number(els.cfgRounds.value) || 5,
    reasoningEffort: els.cfgEffort.value,
    fullAccess: els.cfgFullAccess.checked,
  });
  els.effort.value = els.cfgEffort.value;
  applyFullAccessUI(els.cfgFullAccess.checked);
  els.settingsMsg.textContent = 'Configurações salvas.';
  setTimeout(() => { els.settingsMsg.textContent = ''; }, 2500);
}

/* ---------------- permissões ---------------- */

window.electronAPI.tools.onPermissionRequest(({ id, toolName, args, reason }) => {
  currentPermission = id;
  els.permissionInfo.textContent =
    `Ferramenta: ${toolName}\nMotivo: ${reason}\n\nArgumentos:\n${JSON.stringify(args, null, 2)}`;
  els.permissionModal.hidden = false;
});

async function answerPermission(allowed) {
  if (!currentPermission) return;
  await window.electronAPI.tools.answerPermission(currentPermission, allowed);
  currentPermission = null;
  els.permissionModal.hidden = true;
}

/* ---------------- eventos ---------------- */

document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => {
  setView(b.dataset.view);
  if (b.dataset.view === 'usage') loadUsage();
  if (b.dataset.view === 'history') loadHistory();
  if (b.dataset.view === 'conversations') loadConversations();
}));
els.modeSwitch.querySelectorAll('button').forEach((b) =>
  b.addEventListener('click', () => setMode(b.dataset.mode)));
els.addMcpBtn.addEventListener('click', addMcpServer);
els.refreshMcp.addEventListener('click', async () => {
  await window.electronAPI.mcp.refresh();
  await loadMcp();
  await loadTools();
});
els.refreshUsage.addEventListener('click', loadUsage);
els.openUsageSettings.addEventListener('click', () => window.electronAPI.usage.openSettings());
els.loginBtn.addEventListener('click', startAuth);
els.loginBtn2.addEventListener('click', startAuth);
els.logoutBtn.addEventListener('click', logout);
els.sendBtn.addEventListener('click', send);
els.prompt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); });
els.reloadModelsBtn.addEventListener('click', loadModels);
els.effort.addEventListener('change', async () => {
  await window.electronAPI.settings.set({ reasoningEffort: els.effort.value });
  if (els.cfgEffort) els.cfgEffort.value = els.effort.value;
  logActivity(`Esforço de raciocínio: ${els.effort.value.toUpperCase()}`);
});
els.toolRunBtn.addEventListener('click', runToolFromForm);
els.permAllow.addEventListener('click', () => answerPermission(true));
els.permDeny.addEventListener('click', () => answerPermission(false));
document.querySelectorAll('[data-extract]').forEach((b) => b.addEventListener('click', () => runExtraction(b.dataset.extract)));
els.pickExtractFile.addEventListener('click', async () => {
  const file = await window.electronAPI.dialog.chooseFile();
  if (file) els.extractPath.value = file;
});
els.refreshSystem.addEventListener('click', loadSystem);
els.runCommandBtn.addEventListener('click', runCommandFromForm);
els.refreshHistory.addEventListener('click', loadHistory);
els.newConvBtn.addEventListener('click', createConversation);
els.fullAccessBtn.addEventListener('click', toggleFullAccess);
els.clearHistory.addEventListener('click', async () => {
  await window.electronAPI.tools.clearHistory();
  await loadHistory();
});
els.cfgPickDir.addEventListener('click', async () => {
  const dir = await window.electronAPI.settings.chooseFolder();
  if (dir) els.cfgWorkingDir.value = dir;
});
els.saveSettings.addEventListener('click', saveSettings);

window.electronAPI.onMenuAction?.((action) => {
  const map = {
    'new-chat': () => createConversation(),
    'view-conversations': () => { setView('conversations'); loadConversations(); },
    'choose-folder': async () => { const d = await window.electronAPI.settings.chooseFolder(); if (d) { await loadSettings(); } },
    'view-tools': () => { setView('tools'); loadTools(); },
    'view-mcp': () => { setView('mcp'); loadMcp(); },
    'view-usage': () => { setView('usage'); loadUsage(); },
    'view-history': () => { setView('history'); loadHistory(); },
    'view-settings': () => { setView('settings'); loadSettings(); },
    'view-extract': () => setView('extract'),
    'extract-info': () => { setView('extract'); runExtraction('info'); },
    'extract-audio': () => { setView('extract'); runExtraction('audio'); },
    'extract-frames': () => { setView('extract'); runExtraction('frames'); },
    'transcribe': () => { setView('extract'); runExtraction('transcribe'); },
    'about': () => alert('Codex Desktop — agente local com OAuth+PKCE e ferramentas de extração.'),
  };
  map[action]?.();
});

/* ---------------- init ---------------- */
(async () => {
  const settings = await window.electronAPI.settings.get();
  applyModeUI(settings.mode || 'chat');
  applyFullAccessUI(settings.fullAccess);
  await refreshStatus();
  await loadTools();
  await loadMcp();

  const active = await window.electronAPI.conversations.active();
  if (active) {
    activeConvId = active.id;
    chatHistory.length = 0;
    for (const m of active.messages) chatHistory.push({ role: m.role, content: m.content });
    renderChatMessages();
  } else {
    const conv = await window.electronAPI.conversations.create({ mode: currentMode, model: els.model.value });
    activeConvId = conv.id;
  }
})();
