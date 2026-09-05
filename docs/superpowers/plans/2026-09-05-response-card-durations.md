# Response Card Durations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show segment duration on thinking and tool cards (live while active, frozen when done) and cumulative elapsed time in `MessageMeta` after each segment completes; assistant replies keep total `responseMs`.

**Architecture:** Renderer-owned timing in `App.tsx` using `turnStartedAtRef` (already set on send). Thinking/tool messages store `startedAt` when created and `durationMs`/`elapsedMs` when closed. A shared `useSegmentTimer` hook drives live card-header timers. No agent or IPC changes.

**Tech Stack:** TypeScript, React 19, Electron renderer, existing `formatResponseMs` in `MessageMeta.tsx`

## Global Constraints

- Renderer-owned timing only — no agent-emitted timing events or IPC changes
- Segment timer ticks live on card header while thinking/tool is active; cumulative `elapsedMs` in meta only after segment completes
- Assistant card: total wall-clock in `MessageMeta` via existing `responseMs`; tooltip relabeled to "Total time"
- Reuse `formatResponseMs()` for all duration strings (`450ms`, `4.2s`, `1m 3s`)
- Persist `durationMs` and `elapsedMs` in session `uiMessages`; `startedAt` is ephemeral (not required in persisted JSON)
- Do not change `ActivityIndicator` behavior
- Automated tests deferred — manual verification per spec test plan
- Old sessions without timing fields must render without errors

---

## File map

| File | Responsibility |
| --- | --- |
| `src/shared/types.ts` | `durationMs`, `elapsedMs`, `startedAt` on thinking/tool `UiMessage` variants |
| `src/renderer/src/lib/segmentTiming.ts` | Pure helpers to compute and apply segment timings |
| `src/renderer/src/hooks/useSegmentTimer.ts` | Live/frozen segment timer display string |
| `src/renderer/src/App.tsx` | Open/close segment timing in chat event handlers |
| `src/renderer/src/components/MessageMeta.tsx` | `elapsedMs` prop + "Total time" tooltip rename |
| `src/renderer/src/components/ThinkingCard.tsx` | Segment timer in streaming + collapsed headers |
| `src/renderer/src/components/ToolCallCard.tsx` | Segment timer in running + done headers |
| `src/renderer/src/components/Chat.tsx` | Pass timing props from `UiMessage` to cards |

---

### Task 1: Types and timing helpers

**Files:**
- Modify: `src/shared/types.ts:272-289`
- Create: `src/renderer/src/lib/segmentTiming.ts`

**Interfaces:**
- Produces: `segmentDurationMs`, `elapsedSinceTurnMs`, `closeThinkingMessage`, `closeToolMessage`, `closeStreamingThinking`

- [ ] **Step 1: Extend `UiMessage` thinking and tool variants**

In `src/shared/types.ts`, add optional fields to both variants:

```ts
  | {
      kind: 'thinking'
      id: string
      content: string
      createdAt: string
      streaming?: boolean
      model?: string
      /** Renderer-only: segment start epoch ms (live timer). */
      startedAt?: number
      /** Segment duration once thinking finishes. */
      durationMs?: number
      /** Wall-clock from user send to thinking finish. */
      elapsedMs?: number
    }
  | {
      kind: 'tool'
      id: string
      name: string
      arguments: Record<string, unknown>
      status: 'running' | 'done' | 'error'
      createdAt: string
      result?: string
      model?: string
      /** Renderer-only: segment start epoch ms (live timer). */
      startedAt?: number
      /** Segment duration once tool finishes. */
      durationMs?: number
      /** Wall-clock from user send to tool finish. */
      elapsedMs?: number
    }
```

- [ ] **Step 2: Create `segmentTiming.ts`**

```ts
import type { UiMessage } from '../../../shared/types'

type ThinkingMessage = Extract<UiMessage, { kind: 'thinking' }>
type ToolMessage = Extract<UiMessage, { kind: 'tool' }>

export function segmentDurationMs(
  startedAt?: number,
  now = Date.now()
): number | undefined {
  if (startedAt == null) return undefined
  return Math.max(0, now - startedAt)
}

export function elapsedSinceTurnMs(
  turnStartedAt?: number | null,
  now = Date.now()
): number | undefined {
  if (turnStartedAt == null) return undefined
  return Math.max(0, now - turnStartedAt)
}

export function closeThinkingMessage(
  msg: ThinkingMessage,
  turnStartedAt: number | null | undefined,
  now = Date.now()
): ThinkingMessage {
  return {
    ...msg,
    streaming: false,
    durationMs: segmentDurationMs(msg.startedAt, now),
    elapsedMs: elapsedSinceTurnMs(turnStartedAt, now)
  }
}

export function closeToolMessage(
  msg: ToolMessage,
  turnStartedAt: number | null | undefined,
  now = Date.now()
): ToolMessage {
  return {
    ...msg,
    durationMs: segmentDurationMs(msg.startedAt, now),
    elapsedMs: elapsedSinceTurnMs(turnStartedAt, now)
  }
}

export function closeStreamingThinking(
  messages: UiMessage[],
  turnStartedAt: number | null | undefined,
  now = Date.now()
): UiMessage[] {
  return messages.map((m) =>
    m.kind === 'thinking' && m.streaming
      ? closeThinkingMessage(m, turnStartedAt, now)
      : m
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no consumers yet; types compile)

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/renderer/src/lib/segmentTiming.ts
git commit -m "feat: add segment timing types and helpers"
```

---

### Task 2: Shared segment timer hook

**Files:**
- Create: `src/renderer/src/hooks/useSegmentTimer.ts`

**Interfaces:**
- Consumes: `formatResponseMs` from `../components/MessageMeta`
- Produces: `useSegmentTimer({ active, startedAt, durationMs }) => string | ''`

- [ ] **Step 1: Create the hook**

```ts
import { useEffect, useState } from 'react'
import { formatResponseMs } from '../components/MessageMeta'

interface UseSegmentTimerOptions {
  active: boolean
  startedAt?: number
  durationMs?: number
}

export function useSegmentTimer({
  active,
  startedAt,
  durationMs
}: UseSegmentTimerOptions): string {
  const [liveMs, setLiveMs] = useState(0)

  useEffect(() => {
    if (!active || startedAt == null) {
      setLiveMs(0)
      return
    }
    const tick = (): void => {
      setLiveMs(Date.now() - startedAt)
    }
    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [active, startedAt])

  if (active && startedAt != null) {
    return formatResponseMs(liveMs)
  }
  return formatResponseMs(durationMs)
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/useSegmentTimer.ts
git commit -m "feat: add useSegmentTimer hook for card headers"
```

---

### Task 3: MessageMeta cumulative display

**Files:**
- Modify: `src/renderer/src/components/MessageMeta.tsx`

**Interfaces:**
- Produces: `MessageMeta` accepts optional `elapsedMs?: number`; `responseMs` tooltip reads "Total time"

- [ ] **Step 1: Add `elapsedMs` prop and render it**

Update `MessageMetaProps`:

```ts
interface MessageMetaProps {
  createdAt?: string
  responseMs?: number
  elapsedMs?: number
  tokensPerSec?: number
  model?: string
  contextUsed?: number
  contextLimit?: number
  align?: 'left' | 'right'
}
```

In the component body, after `duration`:

```ts
  const elapsed = formatResponseMs(elapsedMs)
```

Update early return guard:

```ts
  if (!time && !duration && !elapsed && !speed && !modelLabel && !hasContext) return null
```

After the `duration` block, add:

```ts
  if (elapsed) {
    push(
      <span key="elapsed" title="Elapsed since send" className="text-[#8b9aab]">
        {elapsed}
      </span>
    )
  }
```

Change existing `duration` span title from `"Response time"` to `"Total time"`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/MessageMeta.tsx
git commit -m "feat: show elapsed-since-send in MessageMeta"
```

---

### Task 4: App.tsx segment open/close timing

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `closeStreamingThinking`, `closeToolMessage`, `closeThinkingMessage` from `../lib/segmentTiming`
- Produces: thinking messages created with `startedAt`; closed with `durationMs`/`elapsedMs` on chunk, tool_start, assistant_done, assistant_images, done; tool messages closed on tool_result

- [ ] **Step 1: Import helpers**

```ts
import {
  closeStreamingThinking,
  closeToolMessage,
  closeThinkingMessage
} from './lib/segmentTiming'
```

- [ ] **Step 2: Set `startedAt` when creating thinking messages**

In `applyThinkingDelta`, when pushing a new thinking message:

```ts
          next.push({
            kind: 'thinking',
            id: uid(),
            content,
            createdAt: nowIso(),
            streaming: true,
            model: turnModelRef.current ?? undefined,
            startedAt: Date.now()
          })
```

- [ ] **Step 3: Close thinking on first chunk**

In `applyChunkDelta`, replace the thinking close map:

```ts
        let next = closeStreamingThinking(
          prev,
          turnStartedAtRef.current
        )
        next = [...next]
```

- [ ] **Step 4: Close thinking in `assistant_done` / `assistant_images`**

Replace `prev.map((m) => m.kind === 'thinking' && m.streaming ? { ...m, streaming: false } : m)` with:

```ts
          const next = closeStreamingThinking(
            prev,
            turnStartedAtRef.current
          )
```

Apply in both `assistant_done` and `assistant_images` handlers (two occurrences).

- [ ] **Step 5: Close thinking on `tool_start` and set tool `startedAt`**

In the `tool_start` handler, replace the thinking close + tool push:

```ts
          const closed = closeStreamingThinking(
            prev,
            turnStartedAtRef.current
          )
          const last = closed[closed.length - 1]
          const responseMs =
            turnStartedAtRef.current != null
              ? Date.now() - turnStartedAtRef.current
              : undefined
          const withClosed =
            last?.kind === 'assistant' && last.streaming
              ? [
                  ...closed.slice(0, -1),
                  {
                    ...last,
                    streaming: false,
                    createdAt: nowIso(),
                    responseMs: last.responseMs ?? responseMs
                  }
                ]
              : [...closed]
          withClosed.push({
            kind: 'tool',
            id: event.id,
            name: event.name,
            arguments: event.arguments,
            status: 'running',
            createdAt: nowIso(),
            model: turnModelRef.current ?? undefined,
            startedAt: Date.now()
          })
```

- [ ] **Step 6: Close tool on `tool_result`**

Replace the tool map in `tool_result`:

```ts
          const next = prev.map((m) =>
            m.kind === 'tool' && m.id === event.id
              ? closeToolMessage(
                  {
                    ...m,
                    status: event.ok ? ('done' as const) : ('error' as const),
                    result: event.result
                  },
                  turnStartedAtRef.current
                )
              : m
          )
```

- [ ] **Step 7: Close thinking on `done`**

In the `done` handler, also close any lingering streaming thinking:

```ts
          const next = closeStreamingThinking(
            prev.map((m) =>
              m.kind === 'assistant' && m.streaming
                ? {
                    ...m,
                    streaming: false,
                    createdAt: finishedAt,
                    responseMs: m.responseMs ?? responseMs
                  }
                : m
            ),
            turnStartedAtRef.current
          )
```

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: track segment timing in chat event handlers"
```

---

### Task 5: ThinkingCard segment timer UI

**Files:**
- Modify: `src/renderer/src/components/ThinkingCard.tsx`

**Interfaces:**
- Consumes: `useSegmentTimer`, `formatResponseMs` (via hook)
- Produces: `ThinkingCard` props `durationMs`, `elapsedMs`; collapsed header shows frozen segment time

- [ ] **Step 1: Extend props and wire hook**

```ts
import { useSegmentTimer } from '../hooks/useSegmentTimer'

interface ThinkingCardProps {
  content: string
  streaming?: boolean
  startedAt?: number
  durationMs?: number
  elapsedMs?: number
  createdAt?: string
  model?: string
}
```

Remove local `formatElapsed`, `elapsed` state, and the streaming `useEffect` timer.

Add:

```ts
  const segmentLabel = useSegmentTimer({
    active: Boolean(streaming),
    startedAt,
    durationMs
  })
```

- [ ] **Step 2: Streaming header — use `segmentLabel`**

Replace `{formatElapsed(elapsed)}` with `{segmentLabel}` (keep `startedAt` guard or show when `segmentLabel` is non-empty).

- [ ] **Step 3: Collapsed header — show frozen segment duration**

Update the collapsed button row:

```tsx
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-between px-3.5 py-2 text-left hover:bg-[#1a2430]"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#8b9aab]">
                Model thinking
              </span>
              {segmentLabel ? (
                <span className="font-mono text-[11px] tabular-nums text-[#6b7a8c]">
                  {segmentLabel}
                </span>
              ) : null}
            </div>
            <span className="font-mono text-[11px] text-[#6b7a8c]">
              {open ? '−' : '+'}
            </span>
          </button>
```

- [ ] **Step 4: MessageMeta — pass `elapsedMs` when not streaming**

```tsx
      <MessageMeta
        createdAt={createdAt}
        model={model}
        elapsedMs={streaming ? undefined : elapsedMs}
        align="left"
      />
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ThinkingCard.tsx
git commit -m "feat: show segment and elapsed timing on ThinkingCard"
```

---

### Task 6: ToolCallCard segment timer UI

**Files:**
- Modify: `src/renderer/src/components/ToolCallCard.tsx`

**Interfaces:**
- Consumes: `useSegmentTimer`
- Produces: `ToolCallCard` props `startedAt`, `durationMs`, `elapsedMs`

- [ ] **Step 1: Extend props and wire hook**

```ts
import { useSegmentTimer } from '../hooks/useSegmentTimer'

interface ToolCallCardProps {
  name: string
  arguments: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  result?: string
  startedAt?: number
  durationMs?: number
  elapsedMs?: number
  createdAt?: string
  model?: string
}
```

```ts
  const segmentLabel = useSegmentTimer({
    active: running,
    startedAt,
    durationMs
  })
```

- [ ] **Step 2: Running header — add timer before tool name**

In the running header flex row, insert before the `shortName` span:

```tsx
                  {segmentLabel ? (
                    <span className="ml-auto font-mono text-[11px] tabular-nums text-[#6b7a8c]">
                      {segmentLabel}
                    </span>
                  ) : null}
                  <span className={`truncate font-mono text-[11px] text-[#6b7a8c] ${segmentLabel ? '' : 'ml-auto'}`}>
                    {shortName}
                  </span>
```

- [ ] **Step 3: Done/error header — show frozen segment duration**

Inside the collapsed button's left group, after status label:

```tsx
              {segmentLabel ? (
                <span className="font-mono text-[11px] tabular-nums text-[#6b7a8c]">
                  {segmentLabel}
                </span>
              ) : null}
```

- [ ] **Step 4: MessageMeta — pass `elapsedMs` when not running**

```tsx
      <MessageMeta
        createdAt={createdAt}
        model={model}
        elapsedMs={running ? undefined : elapsedMs}
        align="left"
      />
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ToolCallCard.tsx
git commit -m "feat: show segment and elapsed timing on ToolCallCard"
```

---

### Task 7: Chat.tsx prop wiring

**Files:**
- Modify: `src/renderer/src/components/Chat.tsx:657-680`

**Interfaces:**
- Consumes: `UiMessage` timing fields
- Produces: cards receive `startedAt`, `durationMs`, `elapsedMs` from message state (not `activity.startedAt`)

- [ ] **Step 1: Update ThinkingCard usage**

```tsx
              <ThinkingCard
                key={m.id}
                content={m.content}
                streaming={m.streaming}
                createdAt={m.createdAt}
                model={m.model}
                startedAt={m.startedAt}
                durationMs={m.durationMs}
                elapsedMs={m.elapsedMs}
              />
```

Remove `startedAt={m.streaming ? activity.startedAt : undefined}`.

- [ ] **Step 2: Update ToolCallCard usage**

```tsx
              <ToolCallCard
                key={m.id}
                name={m.name}
                arguments={m.arguments}
                status={m.status}
                result={m.result}
                createdAt={m.createdAt}
                model={m.model}
                startedAt={m.startedAt}
                durationMs={m.durationMs}
                elapsedMs={m.elapsedMs}
              />
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Chat.tsx
git commit -m "feat: wire segment timing props to chat cards"
```

---

### Task 8: Manual verification

**Files:** none (runtime verification)

- [ ] **Step 1: Start dev app**

Run: `npm run dev`

- [ ] **Step 2: Thinking model test**

Send a prompt to a thinking-capable model (e.g. qwen3). Confirm:
- Live segment timer ticks on thinking card header while streaming
- When reply text starts, thinking card shows frozen segment duration in collapsed header
- `MessageMeta` under thinking card shows cumulative elapsed (not while streaming)

- [ ] **Step 3: Tool call test**

Ask the model to call an MCP tool. Confirm:
- Live segment timer on running tool card
- Frozen segment duration in done header
- Cumulative elapsed in `MessageMeta` after tool completes

- [ ] **Step 4: Persistence test**

Reload the app or switch sessions and back. Confirm durations remain on historical messages.

- [ ] **Step 5: Show thinking off**

Disable "Show model thinking" in Settings. Confirm assistant reply still shows total `responseMs` in meta with "Total time" tooltip.

- [ ] **Step 6: Final commit if any fixups**

```bash
git add -A
git commit -m "fix: address timing edge cases from manual QA"
```

(Skip this commit if no fixups were needed.)
