'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  workingDirectory: path.join(os.homedir(), 'Desktop'),
  allowShell: true,
  allowWrite: true,
  askConfirmation: true,
  maxToolRounds: 5,
  pythonPath: 'python',
  theme: 'dark',
  mode: 'chat',
  reasoningEffort: 'high',
  fullAccess: false,
  fiveHourLimit: 0,
  fiveHourTokenLimit: 0,
  reuseResponses: false,
  activePlugin: '',
  mcpServers: [],
};

let cache = null;

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function getSettings() {
  if (cache) return { ...cache };
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return { ...cache };
}

function updateSettings(patch) {
  cache = { ...getSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(cache, null, 2), 'utf8');
  return { ...cache };
}

module.exports = { getSettings, updateSettings, DEFAULTS };
