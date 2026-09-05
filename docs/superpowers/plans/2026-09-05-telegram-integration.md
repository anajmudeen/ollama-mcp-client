# Telegram Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the desktop Ollama MCP Client to Telegram via Telegraf so authorized users can mirror/sync chat with the active desktop session, manage sessions via bot commands, and toggle full vs final reply mirroring.

**Architecture:** Telegraf sidecar in the Electron main process using long polling. `telegram-turn.ts` routes Telegram messages into the existing `runAgentTurn` pipeline. `telegram-mirror.ts` subscribes to a shared `chat-events` bus (refactored from `agent.ts` emit) to forward events to allowed Telegram users. Config and allowlist live in `electron-store`; Settings UI and `sessions:changed` IPC keep the renderer in sync.

**Tech Stack:** TypeScript, Electron 35, React 19, Telegraf 4, electron-store

## Global Constraints

- Long polling only — no webhook or public URL
- DMs only — no group chat support in v1
- Telegram-initiated turns: text only (no image/file attachments)
- Shared active session model — Telegram always uses `getActiveSessionId()`
- Mirror mode `'full' | 'final'` default `'full'`; toggleable in Settings and `/mirror`
- Access: `telegramAllowedUserIds`; auto-add first `/start` user when list is empty
- Bot runs only when app is open and `telegramEnabled` + valid token
- Tool results truncated to ~500 chars on Telegram; messages chunked at 4096 chars
- Plain text on Telegram in v1 (no MarkdownV2)
- Token stored in electron-store (same security posture as other settings)
- Automated tests deferred — manual verification per spec test plan
- Run `npm run typecheck` after each task

---

## File map

| File | Responsibility |
| --- | --- |
| `src/shared/types.ts` | `TelegramMirrorMode`, `TelegramStatus`, extend `AppConfig` |
| `src/main/config-store.ts` | Telegram config getters/setters |
| `src/main/chat-events.ts` | Shared `emitChatEvent` + `onChatEvent` subscription bus |
| `src/main/agent.ts` | Use `emitChatEvent` instead of inline `BrowserWindow.send` |
| `src/main/sessions-broadcast.ts` | Push `sessions:changed` to all renderer windows |
| `src/main/telegram-format.ts` | Pure helpers: chunk text, truncate tool results |
| `src/main/telegram-turn.ts` | Append user msg → persist → `runAgentTurn` |
| `src/main/telegram-mirror.ts` | Forward `chat:event` to Telegram based on mirror mode |
| `src/main/telegram-bot.ts` | Telegraf setup, middleware, commands, lifecycle |
| `src/main/ipc.ts` | Telegram IPC handlers; call `broadcastSessionsChanged` from session ops |
| `src/main/index.ts` | Start/stop bot on app ready and quit |
| `src/preload/index.ts` | Expose `telegram` API + `sessions.onChanged` |
| `src/preload/index.d.ts` | (auto via `Api` type) |
| `src/renderer/src/components/Settings.tsx` | Telegram settings section |
| `src/renderer/src/App.tsx` | Load telegram config; listen for `sessions:changed` |

---

### Task 1: Types and config store

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/config-store.ts`

**Interfaces:**
- Produces: `TelegramMirrorMode`, `TelegramStatus`, extended `AppConfig`
- Produces: `getTelegramBotToken`, `setTelegramBotToken`, `getTelegramEnabled`, `setTelegramEnabled`, `getTelegramAllowedUserIds`, `setTelegramAllowedUserIds`, `getTelegramMirrorMode`, `setTelegramMirrorMode`, updated `getConfig()`

- [ ] **Step 1: Add Telegram types to `src/shared/types.ts`**

After `AppConfig` interface, add:

```ts
export type TelegramMirrorMode = 'full' | 'final'

export interface TelegramStatus {
  running: boolean
  error?: string
  botUsername?: string
}
```

Extend `AppConfig`:

```ts
export interface AppConfig {
  ollamaBaseUrl: string
  selectedModel: string | null
  servers: McpServerConfig[]
  showThinking: boolean
  telegramBotToken: string | null
  telegramEnabled: boolean
  telegramAllowedUserIds: number[]
  telegramMirrorMode: TelegramMirrorMode
}
```

- [ ] **Step 2: Extend `config-store.ts` defaults and getters/setters**

Update `DEFAULT_CONFIG`:

```ts
const DEFAULT_CONFIG: AppConfig = {
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  selectedModel: null,
  servers: [],
  showThinking: false,
  telegramBotToken: null,
  telegramEnabled: false,
  telegramAllowedUserIds: [],
  telegramMirrorMode: 'full'
}
```

Update `getConfig()`:

```ts
export function getConfig(): AppConfig {
  return {
    ollamaBaseUrl: store.get('ollamaBaseUrl', DEFAULT_CONFIG.ollamaBaseUrl),
    selectedModel: store.get('selectedModel', DEFAULT_CONFIG.selectedModel),
    servers: store.get('servers', DEFAULT_CONFIG.servers),
    showThinking: store.get('showThinking', DEFAULT_CONFIG.showThinking),
    telegramBotToken: store.get('telegramBotToken', DEFAULT_CONFIG.telegramBotToken),
    telegramEnabled: store.get('telegramEnabled', DEFAULT_CONFIG.telegramEnabled),
    telegramAllowedUserIds: store.get(
      'telegramAllowedUserIds',
      DEFAULT_CONFIG.telegramAllowedUserIds
    ),
    telegramMirrorMode: store.get(
      'telegramMirrorMode',
      DEFAULT_CONFIG.telegramMirrorMode
    )
  }
}
```

Add getters/setters:

```ts
export function getTelegramBotToken(): string | null {
  return store.get('telegramBotToken', DEFAULT_CONFIG.telegramBotToken)
}

export function setTelegramBotToken(token: string | null): string | null {
  const trimmed = token?.trim() || null
  store.set('telegramBotToken', trimmed)
  return trimmed
}

export function getTelegramEnabled(): boolean {
  return store.get('telegramEnabled', DEFAULT_CONFIG.telegramEnabled)
}

export function setTelegramEnabled(enabled: boolean): boolean {
  store.set('telegramEnabled', enabled)
  return enabled
}

export function getTelegramAllowedUserIds(): number[] {
  return [...store.get('telegramAllowedUserIds', DEFAULT_CONFIG.telegramAllowedUserIds)]
}

export function setTelegramAllowedUserIds(ids: number[]): number[] {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id)))]
  store.set('telegramAllowedUserIds', unique)
  return unique
}

export function getTelegramMirrorMode(): TelegramMirrorMode {
  return store.get('telegramMirrorMode', DEFAULT_CONFIG.telegramMirrorMode)
}

export function setTelegramMirrorMode(mode: TelegramMirrorMode): TelegramMirrorMode {
  store.set('telegramMirrorMode', mode)
  return mode
}

export function addTelegramAllowedUserId(id: number): number[] {
  const ids = getTelegramAllowedUserIds()
  if (!ids.includes(id)) ids.push(id)
  return setTelegramAllowedUserIds(ids)
}
```

- [ ] **Step 3: Verify types compile**

Run: `npm run typecheck`
Expected: PASS (may need to fix any `AppConfig` literal sites)

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/main/config-store.ts
git commit -m "feat: add Telegram config types and store accessors"
```

---

### Task 2: Chat event bus and sessions broadcast

**Files:**
- Create: `src/main/chat-events.ts`
- Create: `src/main/sessions-broadcast.ts`
- Modify: `src/main/agent.ts:38-42`

**Interfaces:**
- Produces: `emitChatEvent(event: ChatEvent): void`, `onChatEvent(listener: (event: ChatEvent) => void): () => void`
- Produces: `broadcastSessionsChanged(): void`

- [ ] **Step 1: Create `src/main/chat-events.ts`**

```ts
import { BrowserWindow } from 'electron'
import type { ChatEvent } from '../shared/types'

type ChatEventListener = (event: ChatEvent) => void

const listeners = new Set<ChatEventListener>()

export function onChatEvent(listener: ChatEventListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitChatEvent(event: ChatEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (err) {
      console.error('[chat-events] listener error', err)
    }
  }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('chat:event', event)
  }
}
```

- [ ] **Step 2: Create `src/main/sessions-broadcast.ts`**

```ts
import { BrowserWindow } from 'electron'
import { getSessionsState } from './config-store'

export function broadcastSessionsChanged(): void {
  const state = getSessionsState()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sessions:changed', state)
  }
}
```

- [ ] **Step 3: Refactor `agent.ts` emit to use bus**

Replace:

```ts
function emit(event: ChatEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('chat:event', event)
  }
}
```

With:

```ts
import { emitChatEvent } from './chat-events'

function emit(event: ChatEvent): void {
  emitChatEvent(event)
}
```

Remove unused `BrowserWindow` import from `agent.ts` if no longer needed.

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/chat-events.ts src/main/sessions-broadcast.ts src/main/agent.ts
git commit -m "feat: add chat event bus and sessions broadcast helper"
```

---

### Task 3: Telegram formatting helpers

**Files:**
- Create: `src/main/telegram-format.ts`

**Interfaces:**
- Produces: `TELEGRAM_MAX_MESSAGE_CHARS`, `TELEGRAM_TOOL_RESULT_CHARS`, `chunkTelegramText(text: string): string[]`, `truncateTelegramToolResult(text: string): string`, `formatToolStartLine(name: string, args: Record<string, unknown>): string`, `formatToolResultLine(name: string, ok: boolean, result: string): string`

- [ ] **Step 1: Create `src/main/telegram-format.ts`**

```ts
export const TELEGRAM_MAX_MESSAGE_CHARS = 4096
export const TELEGRAM_TOOL_RESULT_CHARS = 500

export function chunkTelegramText(text: string): string[] {
  if (!text) return ['']
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    chunks.push(text.slice(i, i + TELEGRAM_MAX_MESSAGE_CHARS))
    i += TELEGRAM_MAX_MESSAGE_CHARS
  }
  return chunks
}

export function truncateTelegramToolResult(text: string): string {
  if (text.length <= TELEGRAM_TOOL_RESULT_CHARS) return text
  return `${text.slice(0, TELEGRAM_TOOL_RESULT_CHARS)}…`
}

export function formatToolStartLine(
  name: string,
  args: Record<string, unknown>
): string {
  const argStr = Object.keys(args).length ? ` ${JSON.stringify(args)}` : ''
  return `🔧 Calling ${name}${argStr}`
}

export function formatToolResultLine(
  name: string,
  ok: boolean,
  result: string
): string {
  const prefix = ok ? '✅' : '❌'
  return `${prefix} ${name}: ${truncateTelegramToolResult(result)}`
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/telegram-format.ts
git commit -m "feat: add Telegram message formatting helpers"
```

---

### Task 4: Telegram turn handler

**Files:**
- Create: `src/main/telegram-turn.ts`

**Interfaces:**
- Consumes: `getActiveSessionId`, `getSessionsState`, `updateSession`, `getSelectedModel` from `config-store`; `runAgentTurn` from `agent`; `broadcastSessionsChanged` from `sessions-broadcast`
- Produces: `runTelegramTurn(userText: string): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Create `src/main/telegram-turn.ts`**

```ts
import { randomUUID } from 'crypto'
import type { ChatMessage, UiMessage } from '../shared/types'
import { runAgentTurn } from './agent'
import {
  getActiveSessionId,
  getSelectedModel,
  getSessionsState,
  updateSession
} from './config-store'
import { broadcastSessionsChanged } from './sessions-broadcast'

function nowIso(): string {
  return new Date().toISOString()
}

export async function runTelegramTurn(
  userText: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = userText.trim()
  if (!trimmed) return { ok: false, error: 'Message is empty.' }

  const model = getSelectedModel()
  if (!model) {
    return { ok: false, error: 'Select a model in the desktop app first.' }
  }

  const state = getSessionsState()
  const sessionId = getActiveSessionId() ?? state.activeSessionId
  if (!sessionId) return { ok: false, error: 'No active session.' }

  const session = state.sessions.find((s) => s.id === sessionId)
  if (!session) return { ok: false, error: 'Active session not found.' }

  const turnId = randomUUID()
  const userHistory: ChatMessage = { role: 'user', content: trimmed }
  const userUi: UiMessage = {
    kind: 'user',
    id: randomUUID(),
    content: trimmed,
    createdAt: nowIso(),
    model
  }

  const nextHistory = [...session.history, userHistory]
  const nextUi = [...session.uiMessages, userUi]

  let title = session.title
  if (title === 'New chat') {
    title = trimmed.length > 48 ? `${trimmed.slice(0, 45)}…` : trimmed
  }

  updateSession(sessionId, {
    title,
    history: nextHistory,
    uiMessages: nextUi
  })
  broadcastSessionsChanged()

  void runAgentTurn({
    model,
    messages: nextHistory,
    turnId
  })

  return { ok: true }
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/telegram-turn.ts
git commit -m "feat: add Telegram turn handler for active session"
```

---

### Task 5: Telegram mirror

**Files:**
- Create: `src/main/telegram-mirror.ts`

**Interfaces:**
- Consumes: `onChatEvent` from `chat-events`; `getTelegramAllowedUserIds`, `getTelegramMirrorMode` from `config-store`; format helpers from `telegram-format`
- Produces: `startTelegramMirror(send: TelegramSendFns): () => void`, `resetTelegramMirrorState(): void`
- `TelegramSendFns`: `{ sendText(userId: number, text: string): Promise<void>; sendTextChunks(userId: number, text: string): Promise<void>; editText(userId: number, messageId: number, text: string): Promise<void>; sendPhoto(userId: number, base64: string, caption?: string): Promise<void>; sendTyping(userId: number): Promise<void> }`

- [ ] **Step 1: Create `src/main/telegram-mirror.ts`**

```ts
import type { ChatEvent } from '../shared/types'
import { onChatEvent } from './chat-events'
import {
  getTelegramAllowedUserIds,
  getTelegramMirrorMode
} from './config-store'
import { chunkTelegramText, formatToolResultLine, formatToolStartLine } from './telegram-format'

export interface TelegramSendFns {
  sendText: (userId: number, text: string) => Promise<void>
  sendTextChunks: (userId: number, text: string) => Promise<void>
  editText: (userId: number, messageId: number, text: string) => Promise<void>
  sendPhoto: (userId: number, base64: string, caption?: string) => Promise<void>
  sendTyping: (userId: number) => Promise<void>
}

type StreamState = {
  messageId: number | null
  buffer: string
  lastEditAt: number
}

const streamByUser = new Map<number, StreamState>()
let sendFns: TelegramSendFns | null = null

export function resetTelegramMirrorState(): void {
  streamByUser.clear()
}

async function forEachAllowed(
  fn: (userId: number) => Promise<void>
): Promise<void> {
  const ids = getTelegramAllowedUserIds()
  for (const userId of ids) {
    await fn(userId)
  }
}

async function handleEvent(event: ChatEvent): Promise<void> {
  if (!sendFns) return
  const mode = getTelegramMirrorMode()

  if (event.type === 'error') {
    await forEachAllowed((userId) =>
      sendFns!.sendText(userId, `⚠️ ${event.message}`)
    )
    return
  }

  if (mode === 'final') {
    if (event.type === 'assistant_done' && event.content) {
      await forEachAllowed((userId) =>
        sendFns!.sendTextChunks(userId, event.content)
      )
    } else if (event.type === 'assistant_images') {
      for (const img of event.images) {
        await forEachAllowed((userId) => sendFns!.sendPhoto(userId, img))
      }
    }
    return
  }

  // full mode
  switch (event.type) {
    case 'status':
      await forEachAllowed((userId) => sendFns!.sendTyping(userId))
      if (event.detail) {
        await forEachAllowed((userId) =>
          sendFns!.sendText(userId, `⏳ ${event.detail}`)
        )
      }
      break
    case 'thinking':
      if (event.content.trim()) {
        await forEachAllowed((userId) =>
          sendFns!.sendText(userId, `💭 ${event.content}`)
        )
      }
      break
    case 'tool_start':
      await forEachAllowed((userId) =>
        sendFns!.sendText(
          userId,
          formatToolStartLine(event.name, event.arguments)
        )
      )
      break
    case 'tool_result':
      await forEachAllowed((userId) =>
        sendFns!.sendText(
          userId,
          formatToolResultLine(event.name, event.ok, event.result)
        )
      )
      break
    case 'chunk': {
      await forEachAllowed(async (userId) => {
        const state = streamByUser.get(userId) ?? {
          messageId: null,
          buffer: '',
          lastEditAt: 0
        }
        state.buffer += event.content
        streamByUser.set(userId, state)

        const now = Date.now()
        if (state.messageId == null) {
          const chunks = chunkTelegramText(state.buffer)
          await sendFns!.sendText(userId, chunks[0] ?? '…')
          // messageId set by sendFns implementation via callback — see Task 6
        } else if (now - state.lastEditAt >= 1000) {
          state.lastEditAt = now
          const chunks = chunkTelegramText(state.buffer)
          await sendFns!.editText(userId, state.messageId, chunks[0] ?? '…')
        }
      })
      break
    }
    case 'assistant_done': {
      await forEachAllowed(async (userId) => {
        const state = streamByUser.get(userId)
        if (state?.messageId != null) {
          const chunks = chunkTelegramText(event.content || state.buffer)
          await sendFns!.editText(userId, state.messageId, chunks[0] ?? '')
          if (chunks.length > 1) {
            for (let i = 1; i < chunks.length; i++) {
              await sendFns!.sendText(userId, chunks[i]!)
            }
          }
        } else if (event.content) {
          await sendFns!.sendTextChunks(userId, event.content)
        }
        streamByUser.delete(userId)
      })
      break
    }
    case 'assistant_images':
      for (const img of event.images) {
        await forEachAllowed((userId) => sendFns!.sendPhoto(userId, img))
      }
      break
    case 'done':
      streamByUser.clear()
      break
    default:
      break
  }
}

export function startTelegramMirror(fns: TelegramSendFns): () => void {
  sendFns = fns
  return onChatEvent((event) => {
    void handleEvent(event)
  })
}

export function setStreamMessageId(userId: number, messageId: number): void {
  const state = streamByUser.get(userId) ?? {
    messageId: null,
    buffer: '',
    lastEditAt: 0
  }
  state.messageId = messageId
  state.lastEditAt = Date.now()
  streamByUser.set(userId, state)
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/telegram-mirror.ts
git commit -m "feat: add Telegram chat event mirror"
```

---

### Task 6: Telegraf bot, commands, and lifecycle

**Files:**
- Create: `src/main/telegram-bot.ts`
- Modify: `src/main/index.ts`
- Modify: `package.json` (add `telegraf` dependency)

**Interfaces:**
- Produces: `getTelegramBotStatus(): TelegramStatus`, `startTelegramBot(): Promise<void>`, `stopTelegramBot(): Promise<void>`, `restartTelegramBot(): Promise<void>`

- [ ] **Step 1: Install telegraf**

```bash
npm install telegraf
```

- [ ] **Step 2: Create `src/main/telegram-bot.ts`**

Implement the module with:

1. **State:** `let bot: Telegraf | null`, `let running = false`, `let lastError: string | undefined`, `let stopMirror: (() => void) | null`, `const unauthorizedNotified = new Set<number>()`

2. **`isPrivateChat(ctx)`:** return `ctx.chat?.type === 'private'`

3. **`authMiddleware`:** skip non-private; on `/start` with empty allowlist call `addTelegramAllowedUserId(ctx.from.id)` and welcome; else check allowlist — if missing, reply "Unauthorized" once per user id and return

4. **Send fns** wiring to Telegraf `ctx.telegram`:
   - `sendText` → `telegram.sendMessage(userId, text)`
   - `sendTextChunks` → loop `chunkTelegramText`
   - `editText` → `telegram.editMessageText(userId, messageId, undefined, text)`
   - `sendPhoto` → `Input.fromBuffer(Buffer.from(base64, 'base64'))`
   - `sendTyping` → `sendChatAction(userId, 'typing')`
   - On first `sendText` during a chunk stream, call `setStreamMessageId` with returned `message_id`

5. **Commands:**
   - `/start` — welcome + user id
   - `/help` — command list + current session title + mirror mode
   - `/new` — `createSession()` (from config-store), `broadcastSessionsChanged()`, confirm
   - `/sessions` — list up to 10 sessions with inline keyboard `switch:<sessionId>`
   - `/switch <arg>` — resolve by 1-based index or case-insensitive title substring; `setActiveSession`; broadcast
   - `/delete <arg>` — if only one session, refuse; else show inline confirm `delete:<sessionId>`
   - `/current` — active session title, `uiMessages.length`, `getSelectedModel()`
   - `/mirror on|off|status` — `setTelegramMirrorMode('full'|'final')`, reply status

6. **Text handler:** if message starts with `/`, skip (commands handle); else `runTelegramTurn(text)` and reply with error if `!ok`

7. **`callback_query` handler:** `switch:<id>` → setActive + answer; `delete:<id>` → deleteSession + broadcast

8. **`startTelegramBot`:** read token + enabled; if missing return; create Telegraf, register middleware/handlers, `startTelegramMirror(sendFns)`, `await bot.launch()`, set `running = true`, fetch `bot.telegram.getMe()` for username

9. **`stopTelegramBot`:** `stopMirror?.()`, `await bot?.stop()`, clear state, `resetTelegramMirrorState()`

10. **`restartTelegramBot`:** await stop then start

Export `getTelegramBotStatus()` returning `{ running, error: lastError, botUsername }`.

- [ ] **Step 3: Wire lifecycle in `src/main/index.ts`**

```ts
import { restartTelegramBot, stopTelegramBot } from './telegram-bot'

// inside app.whenReady().then, after registerIpc:
await restartTelegramBot()

// in before-quit:
void stopTelegramBot()
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/main/telegram-bot.ts src/main/index.ts
git commit -m "feat: add Telegraf bot with commands and lifecycle"
```

---

### Task 7: IPC, preload, and session broadcast hooks

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Produces IPC: `telegram:getStatus`, `telegram:setToken`, `telegram:setEnabled`, `telegram:setAllowedUserIds`, `telegram:setMirrorMode`
- Produces preload: `api.telegram.*`, `api.sessions.onChanged`

- [ ] **Step 1: Add telegram IPC handlers in `ipc.ts`**

```ts
import {
  getTelegramBotToken,
  setTelegramBotToken,
  getTelegramEnabled,
  setTelegramEnabled,
  getTelegramAllowedUserIds,
  setTelegramAllowedUserIds,
  getTelegramMirrorMode,
  setTelegramMirrorMode
} from './config-store'
import {
  getTelegramBotStatus,
  restartTelegramBot,
  stopTelegramBot
} from './telegram-bot'
import { broadcastSessionsChanged } from './sessions-broadcast'

ipcMain.handle('telegram:getStatus', () => getTelegramBotStatus())
ipcMain.handle('telegram:setToken', async (_e, token: string | null) => {
  setTelegramBotToken(token)
  await restartTelegramBot()
  return getTelegramBotStatus()
})
ipcMain.handle('telegram:setEnabled', async (_e, enabled: boolean) => {
  setTelegramEnabled(enabled)
  if (enabled) await restartTelegramBot()
  else await stopTelegramBot()
  return getTelegramBotStatus()
})
ipcMain.handle('telegram:setAllowedUserIds', (_e, ids: number[]) => {
  return setTelegramAllowedUserIds(ids)
})
ipcMain.handle('telegram:setMirrorMode', (_e, mode: TelegramMirrorMode) => {
  return setTelegramMirrorMode(mode)
})
```

After `sessions:create`, `sessions:setActive`, `sessions:delete` handlers, add `broadcastSessionsChanged()` to their return paths (and export a helper used by telegram-bot too — already imported there directly).

- [ ] **Step 2: Extend preload `api`**

```ts
import type { TelegramMirrorMode, TelegramStatus } from '../shared/types'

telegram: {
  getStatus: (): Promise<TelegramStatus> =>
    ipcRenderer.invoke('telegram:getStatus'),
  setToken: (token: string | null): Promise<TelegramStatus> =>
    ipcRenderer.invoke('telegram:setToken', token),
  setEnabled: (enabled: boolean): Promise<TelegramStatus> =>
    ipcRenderer.invoke('telegram:setEnabled', enabled),
  setAllowedUserIds: (ids: number[]): Promise<number[]> =>
    ipcRenderer.invoke('telegram:setAllowedUserIds', ids),
  setMirrorMode: (mode: TelegramMirrorMode): Promise<TelegramMirrorMode> =>
    ipcRenderer.invoke('telegram:setMirrorMode', mode)
},

// in sessions:
onChanged: (callback: (state: SessionsState) => void): (() => void) => {
  const handler = (_: Electron.IpcRendererEvent, state: SessionsState): void => {
    callback(state)
  }
  ipcRenderer.on('sessions:changed', handler)
  return () => ipcRenderer.removeListener('sessions:changed', handler)
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts
git commit -m "feat: add Telegram IPC channels and sessions changed listener"
```

---

### Task 8: Settings UI and renderer sync

**Files:**
- Modify: `src/renderer/src/components/Settings.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `window.api.telegram.*`, `window.api.sessions.onChanged`, extended `AppConfig`

- [ ] **Step 1: Extend `Settings.tsx` with Telegram section**

Add props:

```ts
telegramEnabled: boolean
telegramMirrorMode: TelegramMirrorMode
telegramAllowedUserIds: number[]
telegramStatus: TelegramStatus
telegramTokenDraft: string
onSetTelegramToken: (token: string | null) => void
onSetTelegramEnabled: (enabled: boolean) => void
onSetTelegramMirrorMode: (mode: TelegramMirrorMode) => void
onSetTelegramAllowedUserIds: (ids: number[]) => void
```

UI elements:
- Token input (`type="password"` with show toggle)
- Enable switch
- Status row: green dot + "Running as @username" / red "Stopped" / error text
- Mirror mode checkbox: "Stream tool calls & thinking"
- Allowed IDs: text input accepting comma-separated numbers + Save button
- Help text: "Create a bot via @BotFather, paste the token here, then send /start from Telegram."

- [ ] **Step 2: Wire state in `App.tsx`**

Add state:

```ts
const [telegramEnabled, setTelegramEnabled] = useState(false)
const [telegramMirrorMode, setTelegramMirrorMode] = useState<TelegramMirrorMode>('full')
const [telegramAllowedUserIds, setTelegramAllowedUserIds] = useState<number[]>([])
const [telegramStatus, setTelegramStatus] = useState<TelegramStatus>({ running: false })
const [telegramTokenDraft, setTelegramTokenDraft] = useState('')
```

In init `useEffect`, load from `config` and call `window.api.telegram.getStatus()`.

Add handlers calling `window.api.telegram.setToken`, `setEnabled`, `setMirrorMode`, `setAllowedUserIds` and refresh status after each.

Add `useEffect` for `window.api.sessions.onChanged` → `applySessionsState(state)` so Telegram `/new` and `/switch` update the sidebar without reload.

Pass new props to `<Settings … />`.

- [ ] **Step 3: Manual smoke test**

1. Run `npm run dev`
2. Open Settings → Telegram section renders
3. Run `npm run typecheck`

Expected: PASS, no console errors on load

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Settings.tsx src/renderer/src/App.tsx
git commit -m "feat: add Telegram settings UI and sessions sync listener"
```

---

### Task 9: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Full manual test per spec**

Run through all 10 items in `docs/superpowers/specs/2026-09-05-telegram-integration-design.md` § Manual test plan.

- [ ] **Step 2: Fix any issues found**

- [ ] **Step 3: Final commit if fixes needed**

```bash
git commit -m "fix: address Telegram integration manual test findings"
```

---

## Spec coverage checklist

| Spec section | Task |
| --- | --- |
| Config fields | Task 1 |
| Settings UI | Task 8 |
| IPC channels | Task 7 |
| Access control + /start auto-allowlist | Task 6 |
| All bot commands | Task 6 |
| Telegram → Desktop sync | Task 4 |
| Desktop → Telegram mirror | Task 5, 6 |
| Mirror mode full/final | Task 5, 6, 8 |
| Formatting limits | Task 3, 5 |
| Error handling | Task 4, 5, 6 |
| Renderer sessions:changed | Task 7, 8 |
| Bot lifecycle | Task 6 |
| telegraf dependency | Task 6 |
| Manual test plan | Task 9 |
