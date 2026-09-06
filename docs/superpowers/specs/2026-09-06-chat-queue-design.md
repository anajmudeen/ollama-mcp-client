# Chat turn queue (no abort on session switch)

Date: 2026-09-06

## Problem

Switching between chat sessions calls `chat.abort()`, killing the in-flight agent turn. Users lose progress when browsing other sessions. The agent also aborts any running turn when a new one starts.

## Goal

- **Do not abort** when switching sessions — turns continue in the background.
- **Global FIFO queue** — one agent turn at a time; all sources share the same queue.
- **One pending turn per session** — a session may have at most one running or queued turn; block further sends until it completes.
- **Abort** stops only the current turn; queued turns from other sessions still run.
- **UI feedback:** sidebar badge (running/queued) + in-chat *"Waiting in queue…"* on queued user messages.

## Non-goals

- Parallel agent runs (multiple concurrent model calls)
- Per-session independent queues
- Queue reordering / priority lanes

## Architecture

```text
Desktop send ──┐
Telegram turn ─┼──► chat-queue.ts (FIFO) ──► runAgentTurn (single active)
Schedule run ──┘         │
                           ├── queue:changed IPC → renderer
                           └── ChatEvent stream (per turn, with sessionId)
```

### New module: `chat-queue.ts`

| Function | Responsibility |
| --- | --- |
| `enqueueTurn(payload)` | If idle, run immediately; else append if session has no pending entry; emit `queue:changed` |
| `abortCurrentTurn()` | Abort active turn only; on `done`/`error`, dequeue next |
| `removeSessionTurns(sessionId)` | On session delete: abort if running, drop queued entry for that session |
| `getQueueState()` | `{ running: { sessionId, turnId } \| null, queued: { sessionId, turnId }[] }` |
| `getSessionQueueStatus(sessionId)` | `'idle' \| 'running' \| 'queued'` |

**Enqueue rules:**

1. If no turn is running → start `payload` immediately.
2. If a turn is running and `payload.sessionId` already has a queued entry → **reject** (renderer blocks send).
3. If a turn is running and `payload.sessionId` has no queued entry → append to FIFO tail.
4. Telegram and schedule executor call `enqueueTurn` instead of `runAgentTurn` directly.

**`runAgentTurn` change:** remove `abortChat()` at entry. Only the queue module starts turns.

**`isAgentBusy()`:** returns whether any turn is currently running (queue head active).

## Session switch (renderer)

Remove `chat.abort()` from `leaveCurrentSession()` / `handleSelectSession` / `handleNewSession`.

**Switch away from running session:**

1. Snapshot in-flight UI into `backgroundSessionsRef` (existing Telegram path).
2. Clear `activeTurnIdRef`, `busy`, `activity` for the visible session.
3. Turn continues in main; events routed via `sessionId` to background handler.

**Switch back:**

1. If `getSessionQueueStatus(id)` is `running`, re-adopt turn (existing adopt-in-flight logic).
2. Hydrate messages from session store + any buffered background state.
3. Resume live streaming for that session's `turnId`.

## Abort

- `chat:abort` → `abortCurrentTurn()` only.
- Does **not** clear the FIFO queue.
- After abort `error`/`done`, queue advances to next item automatically.

## UI

### Send gating (per session)

- **Idle** → send allowed.
- **Running** (this session is active turn) → send disabled (already busy).
- **Queued** (this session has one queued turn) → send disabled until it completes.
- Other sessions may still send if they are idle (message queues globally).

### Sidebar badge (per session)

| Status | Indicator |
| --- | --- |
| `running` | Pulsing dot |
| `queued` | Static dot |
| `idle` | None |

If a session is both running and queued (impossible with one-pending rule), `running` wins.

### In-chat queued state

Extend user `UiMessage` with optional `queueStatus?: 'queued'`.

- Set when user sends while another session holds the agent.
- Show subtext: *"Waiting in queue…"* under the message.
- Clear when turn starts (`queue:changed` → session moves to `running`, or first `status` event for that `turnId`).

### Queue state sync

- IPC: `queue:getState`, `queue:onChanged`
- Renderer maintains `sessionQueueStatus: Record<sessionId, 'idle' | 'running' | 'queued'>`
- Updated on `queue:changed` and on turn completion

## Data flow

### Send while another session runs

1. User sends in session B (session A running).
2. Renderer appends user message with `queueStatus: 'queued'`, persists session.
3. `chat:send` → `enqueueTurn` → B appended to queue, `queue:changed` emitted.
4. Sidebar: A = running, B = queued.
5. A completes → queue starts B → B = running, `queueStatus` cleared, normal stream events.

### Switch during run

1. Turn running in session A.
2. User switches to B — no abort.
3. A continues; events go to `backgroundSessionsRef[A]`.
4. User switches back to A — adopt in-flight UI, resume streaming.

## Edge cases

| Case | Behavior |
| --- | --- |
| Delete session with queued turn | `removeSessionTurns(id)`; drop queued UI message on next sessions sync |
| Delete session with running turn | Abort if it's the active turn; advance queue |
| Schedule tick while busy | Already skipped (`isAgentBusy`); unchanged |
| Telegram send while busy | Enqueue (one per telegram session max) |
| Second send in same session while queued | Blocked in renderer |
| Clear chat during queued turn | Remove queued entry from queue + UI |

## Files to touch

| File | Change |
| --- | --- |
| `src/main/chat-queue.ts` | **New** — FIFO queue, state, enqueue/abort |
| `src/main/agent.ts` | Remove entry `abortChat()`; export internal runner or accept queue ownership |
| `src/main/ipc.ts` | Route `chat:send` through queue; add `queue:*` handlers |
| `src/main/telegram-turn.ts` | `enqueueTurn` instead of `runAgentTurn` |
| `src/main/schedule-executor.ts` | `enqueueTurn` instead of `runAgentTurn` |
| `src/preload/index.ts` | `queue.getState`, `queue.onChanged` |
| `src/shared/types.ts` | `QueueState`, `UiMessage.queueStatus`, optional `ChatEvent` for queue |
| `src/renderer/src/App.tsx` | Remove abort on switch; queue state; per-session send gate |
| `src/renderer/src/components/Sidebar.tsx` | Running/queued dots |
| `src/renderer/src/components/Chat.tsx` | *"Waiting in queue…"* subtext |

## Manual test

1. Long turn in A → switch to B → A keeps running (sidebar dot on A).
2. Send in B while A runs → B queued label + dot; A finishes → B starts.
3. Second send in B while B queued → blocked.
4. Abort during A → queue advances to B if queued.
5. Telegram message while desktop busy → queues in order.
6. Switch back to A mid-turn → live progress visible.
