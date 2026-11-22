'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { app } = require('electron');
const { getSettings } = require('../settings');

const execFileAsync = promisify(execFile);

function scriptPath() {
  // Em dev: <raiz>/tools/python/extract.py ; em build: resources/tools/python/extract.py
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..', '..');
  return path.join(base, 'tools', 'python', 'extract.py');
}

async function runExtract(command, args = []) {
  const clean = args.filter((a) => a !== undefined && a !== null && a !== '');
  const python = getSettings().pythonPath || 'python';
  try {
    const { stdout, stderr } = await execFileAsync(
      python,
      [scriptPath(), command, ...clean.map(String)],
      { maxBuffer: 12 * 1024 * 1024, timeout: 15 * 60 * 1000, windowsHide: true }
    );
    const line = stdout.trim().split('\n').filter(Boolean).pop();
    if (!line) throw new Error('Saída vazia do extrator' + (stderr ? ': ' + stderr.slice(-400) : ''));
    return JSON.parse(line);
  } catch (err) {
    return { ok: false, error: err.message, stderr: (err.stderr || '').slice(-400) };
  }
}

module.exports = { runExtract, scriptPath };
