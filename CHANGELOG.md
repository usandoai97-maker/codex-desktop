# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.7.0] - 2026-11-22

### Added / Optimized

- Tool-loop rounds now reuse the previous Responses API response via
  `previous_response_id`, sending only the new `function_call_output` items.
  This avoids resending the full tool catalog and conversation history on every
  round — a large input-token saving with no loss of tools or context.
- Graceful fallback to the classic full-payload mode if the backend rejects
  `previous_response_id`/`store`.
- New setting **Reutilizar resposta entre rodadas** (default on) to disable it.

## [1.6.0] - 2026-11-22

### Changed

- Token/cost optimizations without reducing capabilities:
  - system prompt compacted to the same rules in far fewer tokens;
  - MCP tool schemas stripped of metadata with shortened descriptions
    (types, properties and required fields preserved);
  - tool results capped at 20k characters before being fed back into the loop.
- All tools and rules remain available; this only reduces repeated payload size.

## [1.5.0] - 2026-11-22

### Changed

- UI redesigned after the **Codex desktop app** instead of a terminal:
  left sidebar with conversation list, topbar with mode/model/effort/full-access
  controls, chat with right-aligned user bubbles and assistant cards with the ✳
  mark, rounded composer, and a subtle bottom status bar.
- Enter sends the message, Shift+Enter inserts a newline.
- All panels remain reachable from the sidebar.

## [1.4.2] - 2026-11-22

### Changed

- Agent prompt now enforces cleanup on rework: locate old objects with
  `search_game_tree`, destroy them with `execute_luau` (`Instance:Destroy()`)
  before creating replacements, and verify the result afterwards.

## [1.4.1] - 2026-11-22

### Fixed

- `mcp-changed` is no longer emitted for every MCP tool call — only for
  `mcp_connect` / `mcp_disconnect`. This removes the "MCP atualizado via chat"
  spam when the agent uses Roblox Studio tools.
- Agent prompt now forbids repeating `list_roblox_studios` /
  `list_roblox_skills` / `get_roblox_skill` in a loop; after one discovery pass
  it must act with `execute_luau`.

## [1.4.0] - 2026-11-22

### Added

- MCP servers can now be managed **from the chat**: new tools `mcp_connect`,
  `mcp_status` and `mcp_disconnect`. Paste a config like
  `{"mcpServers":{"Roblox_Studio":{"command":"cmd.exe","args":[...]}}}`
  and the agent connects it live; its tools become available in the next loop round.
- The MCP panel refreshes automatically when a server is connected via chat.

## [1.3.1] - 2026-11-22

### Changed

- Conversations are **never** removed automatically. The old 100-conversation cap
  was deleted; only the explicit *Excluir* button removes a conversation.
- Usage panel now says the 5h reset belongs to the **token counter** only, with an
  explicit note that conversations never expire.

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
