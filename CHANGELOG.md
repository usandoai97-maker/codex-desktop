# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.3.0] - 2026-11-22

### Changed

- The 5-hour meter now tracks **real token consumption** from `response.completed`
  events (`total_tokens`), not just message count. Both Chat and Codex feed it.
- New setting `fiveHourTokenLimit` shows a progress bar against a configurable
  token cap; message count and reset time are still displayed.

## [1.2.0] - 2026-11-22

### Added

- **Local 5-hour window counter** shared by Chat and Codex. Every message is
  timestamped in a rolling 5h window and shown in the Usage panel, with reset
  time and an optional configurable cap (`fiveHourLimit`, `0` = count only).
- Honest labelling: the Codex OAuth API only exposes a 30-day window on Free
  accounts (`x-codex-primary-window-minutes: 43200`); the 5h quota shown in the
  ChatGPT web app is not exposed through this token, so the new counter is local
  and clearly marked as such.

## [1.1.0] - 2026-11-21

### Added

- **Full Access** mode for Codex: a toggle in the chat header and a setting that
  disables every permission prompt. When enabled, dangerous tools (PowerShell/cmd,
  file writes, deletes, process termination) run without confirmation and ignore
  the `allowShell` / `allowWrite` flags. Use at your own risk.
- Warning banner in the chat subtitle while Full Access is active.

## [1.0.1] - 2026-11-21

### Fixed

- Tool-call names are now also captured from `response.output_item.added`.
  Previously, when the Codex backend omitted the name from
  `response.function_call_arguments.done`, the follow-up request was sent with
  `name: ""` and rejected with `HTTP 400 invalid_request_error` (`empty_string`).
- Missing tool names now fall back to `unknown_tool`, so the Responses API never
  receives an empty string.
- Hardened the function-call parsing for `item_id` / `call_id` variations.

## [1.0.0] - 2026-11-21

First public release. Recreates the architecture shown in the Pessoa video and
extends it into a local agent.

### Added

- **OAuth 2.0 + PKCE** sign-in with the public Codex CLI client ID, local callback
  server on `127.0.0.1:1455`, CSRF `state` validation and encrypted token storage
  via Electron `safeStorage` (DPAPI on Windows / Keychain on macOS).
- **Auto-refresh** of access tokens with a 60-second buffer.
- **Two modes**
  - `Chat` — conversation only, no tools.
  - `Codex` — full agent with PowerShell/cmd, files, folders, processes, clipboard,
    media extraction and MCP tools.
- **23 local tools** registered as function tools, plus dynamically discovered
  MCP tools.
- **MCP client** using the official `@modelcontextprotocol/sdk` over stdio.
- **Reasoning effort selector**: LOW / MED / HIGH / MAX (`xhigh`), sent as
  `reasoning.effort`, with automatic fallback if the backend rejects it.
- **Usage panel** backed by `chatgpt.com/backend-api/wham/usage`, including
  5-hour/weekly windows, additional limits, credits and graceful HTTP 429 handling.
- **Saved conversations** persisted to `conversations.json`, with open/rename/delete
  and automatic restore of the last active conversation.
- **Unified activity history** (messages + tool calls) persisted to `history.json`.
- **Video extraction panel** using ffmpeg and Whisper: media info, MP3, frames,
  contact sheets and transcription.
- Native menu and sidebar with nine panels.
- `INSTALAR.bat` installer that installs dependencies and creates the desktop shortcut.
- Five mock-based test suites (OAuth, proxy, tools, usage, conversations).
