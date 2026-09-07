# Telegram integration

Date: 2026-09-05

## Problem

The Ollama MCP Client is a desktop-only Electron app. Users cannot interact with their local Ollama + MCP agent from mobile or when away from the desktop UI. There is no remote channel to send messages or receive replies.

## Goal

Connect the application to Telegram via a bot (Telegraf). Users configure the bot token in Settings. Telegram and the desktop app **mirror/sync** the same chat sessions:

- Telegram always talks to the **active desktop session** (shared session model).
- Messages sent from either side appear in both places.
- Users can manage sessions from Telegram via bot commands.
- Full mirror of tool calls and thinking to Telegram by default, toggleable in Settings or via `/mirror`.

## Non-goals (v1)

- Group chats (DMs only)
- Telegram → desktop image/file attachments
- Webhook mode (long polling only; no public URL required)
- Encrypting bot token beyond `electron-store` defaults
- Slash skills (`/skillname`) from Telegram
- Bot running when the desktop app is closed

## Approach

**Telegraf sidecar in the Electron main process** (recommended over a session-coordinator refactor or a separate Telegram-only agent path).

- Reuses the existing `runAgentTurn` agent loop and MCP tool stack.
- Subscribes to the existing `chat:event` stream for desktop → Telegram mirroring.
- Minimal renderer changes (Settings UI + `sessions:changed` listener).

## Architecture

```
┌─────────────┐     IPC      ┌──────────────────────────────────────┐
│  Renderer   │◄────────────►│           Main process               │
│  (React UI) │  chat:event  │  agent.ts ──► Ollama + MCP          │
└─────────────┘              │       ▲                              │
       ▲                     │       │ chat:event (existing)        │
       │ sessions:changed     │  telegram-bot.ts (Telegraf)        │
       └─────────────────────│  telegram-mirror.ts                  │
                              │  telegram-turn.ts                    │
                              └───────┼──────────────────────────────┘
                                      ▼
                              Telegram Bot API (long polling)
```

### New modules (main process)

| Module | Responsibility |
| --- | --- |
| `telegram-bot.ts` | Telegraf setup, command handlers, access middleware, start/stop lifecycle |
| `telegram-mirror.ts` | Subscribe to `chat:event`, format and send to Telegram based on mirror mode |
| `telegram-turn.ts` | Append user message → persist session → build `ChatSendPayload` → `runAgentTurn` |

### Lifecycle

- Bot starts when app is ready **and** `telegramBotToken` is set **and** `telegramEnabled` is true.
- Bot stops on app quit, token clear, or disable toggle.
- Uses **long polling** via `bot.launch()` — no webhook or public URL.

## Config & Settings

Extend `AppConfig` and `electron-store` (`config-store.ts`):

| Field | Type | Default |
| --- | --- | --- |
| `telegramBotToken` | `string \| null` | `null` |
| `telegramEnabled` | `boolean` | `false` |
| `telegramAllowedUserIds` | `number[]` | `[]` |
| `telegramMirrorMode` | `'full' \| 'final'` | `'full'` |

### Settings UI

New **Telegram** section in `Settings.tsx`:

- Bot token input (masked with show/hide toggle)
- Enable/disable switch
- Connection status indicator (Running / Stopped / Invalid token)
- Allowed user IDs editor (comma-separated or tag-style add/remove)
- Mirror mode toggle: "Stream tool calls & thinking" (`full` vs `final`)
- Brief link/instructions for creating a bot via BotFather

Token is stored in `electron-store` with the same local-only security posture as other settings.

### IPC

| Channel | Direction | Purpose |
| --- | --- | --- |
| `telegram:getStatus` | invoke | Bot running state, last error |
| `telegram:setToken` | invoke | Save token, restart bot |
| `telegram:setEnabled` | invoke | Enable/disable bot |
| `telegram:setAllowedUserIds` | invoke | Update allowlist |
| `telegram:setMirrorMode` | invoke | Update mirror mode |
| `sessions:changed` | push | Broadcast session list/active changes to renderer |

## Access control

Telegraf middleware on every update:

1. If `ctx.from.id` is not in `telegramAllowedUserIds` → reply "Unauthorized" once per session and drop the update.
2. **First `/start` when allowlist is empty** → auto-add that user's Telegram ID as owner, persist, send welcome message showing their ID.
3. Additional user IDs can be added or removed manually in Settings.

DMs only — no group chat support in v1.

## Bot commands

| Command | Behavior |
| --- | --- |
| `/help` | List commands and show current session / mirror status |
| `/new` | `createSession()` + `setActiveSession()` → broadcast `sessions:changed` |
| `/sessions` | List recent sessions (title + index) with inline keyboard to switch |
| `/switch <#\|title>` | `setActiveSession()` by index or partial title match |
| `/delete <#\|title>` | Delete session with inline confirmation button; cannot delete the last session |
| `/current` | Show active session title, message count, selected model |
| `/mirror on\|off\|status` | Toggle or display `telegramMirrorMode` (persisted to config) |

Non-command text from an authorized user is treated as a chat message on the **active session**.

## Sync flow

### Telegram → Desktop

1. Authorized user sends text (not a command).
2. `telegram-turn.ts` appends the user message to the active session (`history` + `uiMessages`).
3. Broadcast `sessions:changed` so the renderer refreshes sidebar and chat.
4. Build `ChatSendPayload` using `getSelectedModel()` and session history.
5. Call `runAgentTurn(payload)` — same path as the desktop send button.

### Desktop → Telegram

1. `telegram-mirror.ts` subscribes to `chat:event` (refactor `emit()` in `agent.ts` to notify a shared listener, or have mirror hook into the existing emit path).
2. Forward events to **all allowed user IDs** (each user's DM with the bot).
3. Mirror mode behavior:
   - **`full`**: forward `status`, `thinking`, `tool_start`, `tool_result` (truncated), streaming `chunk`, `assistant_done`, and images.
   - **`final`**: forward only `assistant_done` and images; errors are always sent regardless of mode.

### Concurrency

If desktop and Telegram both send while a turn is in progress, existing `abortChat()` behavior applies (latest turn wins).

## Telegram formatting & limits

- Chunk messages at 4096 characters (Telegram limit).
- Use plain text for tool/status lines in v1 (avoid MarkdownV2 escaping complexity).
- Assistant reply streaming: one message edited via `editMessageText` (throttled ~1 s) during `chunk` events; `assistant_done` sets the final text.
- `sendChatAction('typing')` while a turn is in progress.
- Images: `sendPhoto` from base64 buffer on `assistant_images` events.
- Tool results truncated to ~500 characters on Telegram with `…` suffix.
- Telegram-initiated turns: text only in v1 (no attachments).

## Error handling

| Case | Behavior |
| --- | --- |
| Invalid or revoked token | Settings shows error; bot stops; app does not crash |
| Ollama offline | Telegram receives readable error from agent `error` event |
| No model selected | Reply: "Select a model in the desktop app first" |
| Telegram API rate limit | Queue with backoff; log warning |
| App quit | `bot.stop()` in `before-quit` handler |

## Renderer changes (minimal)

- Listen for `sessions:changed` IPC push → reload sessions state (sidebar + active chat).
- When Telegram appends a message to the active session, renderer picks it up via `sessions:changed` without re-sending to the agent.
- Settings modal gains the Telegram section described above.
- No new pages.

## Dependencies

- `telegraf` (npm dependency, main process only)

## Manual test plan

1. Create a bot via BotFather; paste token in Settings; enable bot.
2. Send `/start` from Telegram — verify auto-allowlist and welcome message.
3. Send a message from Telegram — verify it appears in the desktop active session and agent replies in both places.
4. Send a message from desktop — verify mirror appears on Telegram.
5. Run `/new`, `/sessions`, `/switch`, `/delete`, `/current` — verify desktop sidebar stays in sync.
6. Toggle `/mirror off` — verify only final replies appear on Telegram; tool/thinking suppressed.
7. Toggle mirror back on in Settings — verify full stream resumes.
8. Send unauthorized message from a different Telegram account — verify rejection.
9. Stop Ollama — verify Telegram gets a readable error.
10. Quit app — verify bot stops (no ghost polling).
