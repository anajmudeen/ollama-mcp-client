# Response card durations

Date: 2026-09-05

## Problem

Chat response cards (thinking, tool calls, assistant replies) give little timing feedback. Thinking shows a live timer only while streaming and it disappears when collapsed. Tool cards show no duration at all. Assistant replies have total wall-clock time in `MessageMeta`, but thinking and tool segments do not.

## Goal

Show duration on every response card type:

| Card | Segment duration (on card) | Cumulative (in meta footer) |
| --- | --- | --- |
| Thinking | How long this thinking block ran | Elapsed since user send — shown only when segment completes |
| Tool call | How long the tool call ran | Elapsed since user send — shown only when segment completes |
| Assistant reply | *(none on card)* | Total wall-clock from user send to reply finish (existing `responseMs`) |

While a thinking or tool segment is active, the card header shows a **live ticking** segment timer. Cumulative elapsed appears in `MessageMeta` only after the segment finishes.

## Non-goals

- Agent-emitted timing events (IPC changes)
- Per-token or per-iteration breakdowns
- Settings toggle to hide durations
- Automated tests (deferred; manual test plan below)
- Changing `ActivityIndicator` behavior

## Approach

**Renderer-owned timing** in `App.tsx`, matching the existing `responseMs` / `turnStartedAtRef` pattern. No agent or IPC changes.

Segment boundaries are recorded when messages are created and closed in the renderer event handlers.

## Data model

New optional fields on `UiMessage` in `src/shared/types.ts`:

| Kind | Field | Meaning |
| --- | --- | --- |
| `thinking` | `durationMs` | Segment: how long this thinking block ran |
| `thinking` | `elapsedMs` | Cumulative: wall-clock from user send to thinking finished |
| `tool` | `durationMs` | Segment: how long the tool call ran |
| `tool` | `elapsedMs` | Cumulative: wall-clock from user send to tool finished |
| `assistant` | `responseMs` | *(existing)* Total wall-clock from user send to reply finished |

Renderer-only field (not persisted separately; used for live timer):

| Kind | Field | Meaning |
| --- | --- | --- |
| `thinking`, `tool` | `startedAt` | `Date.now()` when segment began (number, optional) |

`durationMs` and `elapsedMs` are persisted in session `uiMessages` so historical chats retain timings.

## Segment boundaries

**Thinking** segment starts when a `thinking` message is pushed. It ends when:

1. First assistant `chunk` arrives
2. `tool_start` fires
3. Turn completes (`assistant_done`, `assistant_images`, `error`, `done`)

**Tool** segment starts at `tool_start` (`createdAt` + `startedAt`). Ends on `tool_result` (success or error).

**Assistant** segment ends on `assistant_done` / `assistant_images` (existing `responseMs` logic unchanged).

## Data flow (`App.tsx`)

Helper `closeSegmentTiming(msg, turnStartedAt)`:

```ts
const now = Date.now()
return {
  ...msg,
  streaming: false, // thinking only
  durationMs: msg.startedAt ? now - msg.startedAt : undefined,
  elapsedMs: turnStartedAt ? now - turnStartedAt : undefined,
}
```

Apply when closing thinking segments (in `applyChunkDelta`, `tool_start`, `assistant_done`, etc.) and on `tool_result` for tool messages.

On thinking message create: set `startedAt: Date.now()`.

On `tool_start`: push tool message with `startedAt: Date.now()`.

On `tool_result`: set `durationMs` and `elapsedMs` on the matching tool message by id.

## UI components

### Shared hook: `useSegmentTimer`

```ts
useSegmentTimer({ active, startedAt, durationMs })
```

- While `active`: tick every 200ms from `startedAt`, display via `formatResponseMs`
- When done: display frozen `durationMs`

### ThinkingCard

- **Streaming header**: live segment timer (right-aligned, mono) driven by message `startedAt` (not turn-level `activity.startedAt`)
- **Collapsed header**: frozen segment duration next to "Model thinking" label (e.g. `4.2s`)
- **MessageMeta**: pass `elapsedMs` when segment complete; omit while streaming

### ToolCallCard

- **Running header**: live segment timer (same style/placement as ThinkingCard)
- **Done/error header**: frozen segment duration next to tool name
- **MessageMeta**: pass `elapsedMs` when `status !== 'running'`

### Assistant card

- No header timer change
- `responseMs` in `MessageMeta` only (hidden while streaming, shown when done)
- Tooltip relabeled from "Response time" to "Total time"

### MessageMeta extension

- New optional `elapsedMs` prop
- Render after model/time, before tokens/sec: `· 12.3s` with `title="Elapsed since send"`
- Reuse `formatResponseMs()` for all duration displays

## Edge cases

| Case | Behavior |
| --- | --- |
| Thinking hidden (`showThinking=false`) | No thinking card rendered; timing tracked internally but not shown |
| Aborted turn | Partial segments keep duration reached so far; cumulative only if segment formally closed |
| Multiple tool calls in one turn | Each tool card gets its own segment + cumulative at finish time |
| Multiple thinking blocks (re-synthesize) | Each thinking message closed independently when next phase starts |
| Old sessions without `durationMs` | Cards render without duration; no crash |
| Image-only reply | `responseMs` on assistant card as today |

## Files to change

| File | Change |
| --- | --- |
| `src/shared/types.ts` | Add `durationMs`, `elapsedMs`, `startedAt` to thinking/tool variants |
| `src/renderer/src/App.tsx` | Segment open/close timing in event handlers |
| `src/renderer/src/components/MessageMeta.tsx` | Add `elapsedMs` prop and display |
| `src/renderer/src/components/ThinkingCard.tsx` | Segment timer in collapsed header; use message `startedAt` |
| `src/renderer/src/components/ToolCallCard.tsx` | Live + frozen segment timer in header |
| `src/renderer/src/components/Chat.tsx` | Pass new props to cards |
| `src/renderer/src/hooks/useSegmentTimer.ts` | New shared hook (optional file) |

## Manual test plan

1. Send a prompt to a thinking model — verify live timer on thinking card; frozen segment + cumulative in meta when reply starts
2. Trigger a tool call — verify live timer while running; both durations in meta when done
3. Reload session — durations persist on historical messages
4. Toggle "Show thinking" off — assistant still shows total `responseMs`
5. Multi-tool turn — each tool card shows independent segment and cumulative times
