# Codex Desktop

A local Electron agent built by reverse-engineering the OAuth + PKCE flow used by
the OpenAI Codex CLI. It signs in with your own ChatGPT account and proxies requests
through the Codex backend — no separate API key.

> **Educational project.** Using the Codex CLI `client_id` in a third-party app and
> calling the private Codex backend may violate OpenAI's Terms of Use. Use at your
> own risk. The OpenAI-backed endpoint is private and may change or stop working at
> any time.

## Features

- **Two modes**
  - 💬 **Chat** — plain conversation, no tools and no machine access.
  - ⚡ **Codex** — full local agent: PowerShell/cmd, files, folders, processes,
    clipboard, MCP servers and media extraction. Optional **Full Access** toggle
    (`🔓 Full`) disables all permission prompts.
- **26 local tools** plus dynamically discovered **MCP** tools, including
  `mcp_connect` / `mcp_status` / `mcp_disconnect` to manage servers from the chat.
- **Reasoning effort** selector: LOW / MED / HIGH / MAX (`xhigh`).
- **Usage panel** using the same endpoint as the Codex CLI (`wham/usage`), plus a
  local rolling **5-hour token meter** fed by both Chat and Codex from
  `response.completed` usage data (the Codex OAuth API only exposes a 30-day
  window on Free accounts), with graceful HTTP 429 handling.
- **Saved conversations** and a unified activity history that survive restarts.
- **Video extraction** panel: audio, frames, contact sheets and Whisper transcription.
- Native menu and a sidebar with 9 panels.

## Install (Windows)

Double-click **`INSTALAR.bat`**. It will:

1. run `npm install`;
2. download the Electron binary;
3. create a **Codex Desktop** shortcut on your Desktop.

Then double-click the shortcut.

Manual install:

```powershell
npm install
node node_modules/electron/install.js
npm start
```

Optional (media extraction):

```powershell
python -m pip install imageio-ffmpeg faster-whisper
```

## Architecture

```
Renderer (plain JS, same role as React in the original video)
   │  window.electronAPI.*
   ▼
preload.js (contextBridge) ── IPC ──▶ Main Process (Node.js)
                                        ├─ codexAuth.js   OAuth + PKCE + tokens
                                        ├─ codexApi.js    proxy + tool loop + 429
                                        ├─ tools/         local tools
                                        ├─ mcp/           MCP client (stdio)
                                        ├─ usage.js       quota/usage
                                        └─ conversations.js / history.js
                                                 │
                                                 ▼
                                   auth.openai.com / chatgpt.com
```

OAuth constants match the public Codex CLI:

- `client_id`: `app_EMoamEEZ73f0CkXaXp7hrann`
- `redirect_uri`: `http://127.0.0.1:1455/auth/callback`
- scopes: `openid profile email offline_access api.connectors.read api.connectors.invoke`

Tokens are encrypted with Electron `safeStorage` (DPAPI on Windows, Keychain on macOS).

## Tests

```powershell
npm test
```

Five mock-based suites cover the OAuth flow, proxy/tool loop, local tools, usage
endpoint and conversation persistence. No real account or network access required.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

Educational use only. Not affiliated with OpenAI.
