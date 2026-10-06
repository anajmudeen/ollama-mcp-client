# Reasoning effort in message metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the last model call’s effective `reasoning_effort` inline on each assistant `MessageMeta` row and persist it on assistant `UiMessage` entries.

**Architecture:** OpenAI/Azure chat stream functions set `reasoningEffortSent` on the stream result when `reasoning_effort` is included on the HTTP body (same resolution as today). The agent keeps the last value across tool-loop and wrap-up streams and emits it on `assistant_done`. The renderer copies it into session `uiMessages` and passes it to `MessageMeta`.

**Tech Stack:** TypeScript, Electron main/renderer, existing `ChatEvent` pipeline, `ReasoningEffort` from `src/shared/reasoning-effort.ts`.

## Global Constraints

- Show **API-sent** effort, not the chat picker alone.
- Multi-call turns: use effort from the **last** `llm.chatStream` in the turn.
- Inline segment: raw `none` | `low` | `medium` | `high` with `title="Reasoning effort"`.
- **Omit** the field when the model does not support `reasoning_effort` (not the same as sending `none`).
- No per-call tooltip breakdown; no Telegram UI changes.
- Run `npm run typecheck` after each task.

---

## File map

| File | Role |
| --- | --- |
| `src/shared/types.ts` | `assistant_done` + assistant `UiMessage` optional `reasoningEffort` |
| `src/main/llm/types.ts` | `LlmChatStreamResult.reasoningEffortSent` |
| `src/main/openai-client.ts` | Set `reasoningEffortSent` on `OpenAiStreamResult` |
| `src/main/llm/openai-provider.ts` | Pass `reasoningEffortSent` through to `LlmChatStreamResult` |
| `src/main/azure-openai-client.ts` | Same on Azure stream path |
| `src/main/llm/azure-openai-provider.ts` | Pass through if needed (mirror OpenAI provider) |
| `src/main/agent.ts` | Track `lastReasoningEffort`; emit on `assistant_done` |
| `src/renderer/src/components/MessageMeta.tsx` | Inline segment |
| `src/renderer/src/components/Chat.tsx` | Pass prop to `MessageMeta` |
| `src/renderer/src/App.tsx` | Copy from `assistant_done` event |
| `src/renderer/src/lib/backgroundChatEvents.ts` | Same for background sessions |
| `scripts/test-reasoning-effort-stream-meta.mjs` | Node test for effort resolution used on streams |

---

### Task 1: Shared types

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/llm/types.ts`

**Interfaces:**
- Produces: `ChatEvent` `assistant_done.reasoningEffort?: ReasoningEffort`
- Produces: `UiMessage` assistant `reasoningEffort?: ReasoningEffort`
- Produces: `LlmChatStreamResult.reasoningEffortSent?: ReasoningEffort`

- [ ] **Step 1: Extend `assistant_done` in `types.ts`**

Add after `multiCallTurn?: boolean` on the `assistant_done` variant:

```ts
      /** Last chatStream in the turn: reasoning_effort sent on the API, if any. */
      reasoningEffort?: ReasoningEffort
```

Add the same optional field on the assistant branch of `UiMessage` (after `multiCallTurn?: boolean`).

- [ ] **Step 2: Extend `LlmChatStreamResult` in `src/main/llm/types.ts`**

```ts
  /** Present when this provider included reasoning_effort on the chat request. */
  reasoningEffortSent?: ReasoningEffort
```

Import `ReasoningEffort` from `../../shared/reasoning-effort` (or re-export via `types` if that matches nearby imports).

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`  
Expected: PASS (no consumers yet).

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/main/llm/types.ts
git commit -m "feat: add reasoning effort fields for assistant message meta"
```

---

### Task 2: OpenAI stream result

**Files:**
- Modify: `src/main/openai-client.ts`
- Modify: `src/main/llm/openai-provider.ts`

**Interfaces:**
- Consumes: `resolveReasoningEffortForRequest`, `getReasoningEffort`, `ReasoningEffort`
- Produces: `OpenAiStreamResult.reasoningEffortSent?: ReasoningEffort`

- [ ] **Step 1: Extend `OpenAiStreamResult`**

In `src/main/openai-client.ts`, add to the interface:

```ts
  reasoningEffortSent?: ReasoningEffort
```

Add `import type { ReasoningEffort } from '../shared/reasoning-effort'` if not already present.

- [ ] **Step 2: Set effort on `openAiChatStream` return**

After computing `effort` (existing block around `resolveReasoningEffortForRequest`):

```ts
  const reasoningEffortSent = effort
```

On the final `return` of `openAiChatStream`:

```ts
  return {
    content,
    toolCalls,
    promptEvalCount,
    evalCount,
    usage,
    reasoningEffortSent
  }
```

(`reasoningEffortSent` is `undefined` when `effort` was omitted — do not set the property or set explicitly to `effort` which is already `undefined`.)

- [ ] **Step 3: Pass through in `openai-provider.ts`**

In the `chatStream` return object:

```ts
      reasoningEffortSent: result.reasoningEffortSent
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/openai-client.ts src/main/llm/openai-provider.ts
git commit -m "feat: return reasoning effort sent on OpenAI chat streams"
```

---

### Task 3: Azure stream result

**Files:**
- Modify: `src/main/azure-openai-client.ts`
- Modify: `src/main/llm/azure-openai-provider.ts`

**Interfaces:**
- Produces: Azure `azureOpenAiChatStream` → `OpenAiStreamResult` with `reasoningEffortSent`

- [ ] **Step 1: Refactor `buildChatBody` to expose effort**

Change `buildChatBody` to return `{ body: Record<string, unknown>; reasoningEffortSent?: ReasoningEffort }`:

```ts
function buildChatBody(
  options: AzureChatOptions,
  stream: boolean
): { body: Record<string, unknown>; reasoningEffortSent?: ReasoningEffort } {
  const body: Record<string, unknown> = {
    messages: ollamaMessagesToOpenAi(options.messages),
    stream
  }
  if (stream) body.stream_options = { include_usage: true }
  if (options.tools?.length) {
    body.tools = ollamaToolsToOpenAi(options.tools)
  }
  const effort = resolveReasoningEffortForRequest({
    model: options.deployment,
    hasTools: Boolean(options.tools?.length),
    preference: getReasoningEffort()
  })
  if (effort !== undefined) body.reasoning_effort = effort
  return { body, reasoningEffortSent: effort }
}
```

Update `azureOpenAiChatOnce` and `azureOpenAiChatStream` call sites to use `buildChatBody(...).body`.

- [ ] **Step 2: Return `reasoningEffortSent` from `azureOpenAiChatStream`**

At the start of `azureOpenAiChatStream`:

```ts
  const { body, reasoningEffortSent } = buildChatBody(options, true)
```

Use `body` in `JSON.stringify(body)`.

At the end, include `reasoningEffortSent` on the returned `OpenAiStreamResult` (same shape as OpenAI client).

- [ ] **Step 3: Azure provider pass-through**

In `src/main/llm/azure-openai-provider.ts` `chatStream`, map `reasoningEffortSent: result.reasoningEffortSent` on the returned `LlmChatStreamResult` (mirror `openai-provider.ts`).

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/azure-openai-client.ts src/main/llm/azure-openai-provider.ts
git commit -m "feat: return reasoning effort sent on Azure chat streams"
```

---

### Task 4: Agent turn tracking

**Files:**
- Modify: `src/main/agent.ts`

**Interfaces:**
- Consumes: `LlmChatStreamResult.reasoningEffortSent`
- Produces: `assistant_done.reasoningEffort`

- [ ] **Step 1: Declare turn-level variable**

Near `let turnUsage = emptyTokenUsage(effective)` and `let modelCallCount = 0`:

```ts
  let lastReasoningEffort: ReasoningEffort | undefined
```

Import `ReasoningEffort` from `../shared/reasoning-effort`.

- [ ] **Step 2: Helper to update after each stream**

After `modelCallCount += 1` in the tool-loop path (immediately after `mergeLlmStreamUsage`):

```ts
      if (streamResult.reasoningEffortSent !== undefined) {
        lastReasoningEffort = streamResult.reasoningEffortSent
      }
```

Repeat after the wrap-up `wrapStreamResult` block (`modelCallCount += 1` following `wrapStreamResult`).

- [ ] **Step 3: Emit on `assistant_done`**

In `completeAssistantTurn`, extend `emitTurn({ type: 'assistant_done', ... })`:

```ts
      reasoningEffort: lastReasoningEffort
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent.ts
git commit -m "feat: emit last-call reasoning effort on assistant_done"
```

---

### Task 5: MessageMeta UI

**Files:**
- Modify: `src/renderer/src/components/MessageMeta.tsx`
- Modify: `src/renderer/src/components/Chat.tsx`

**Interfaces:**
- Consumes: `reasoningEffort?: ReasoningEffort` on `MessageMetaProps`

- [ ] **Step 1: Add prop and render segment**

In `MessageMetaProps`:

```ts
  reasoningEffort?: ReasoningEffort
```

Destructure in `MessageMeta`.

Update early return guard to include `reasoningEffort` (show meta row when only effort is set).

After the `speed` block and before `hasContext`, add:

```ts
  if (reasoningEffort) {
    push(
      <span
        key="reasoning-effort"
        title="Reasoning effort"
        className="text-[#8b9aab]"
      >
        {reasoningEffort}
      </span>
    )
  }
```

- [ ] **Step 2: Wire `Chat.tsx`**

On the assistant `MessageMeta` usage (~line 756), add:

```tsx
                    reasoningEffort={m.streaming ? undefined : m.reasoningEffort}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`  
Expected: PASS (UiMessage field added in Task 1; may warn until Task 6 wires events).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/MessageMeta.tsx src/renderer/src/components/Chat.tsx
git commit -m "feat: show reasoning effort inline in MessageMeta"
```

---

### Task 6: Renderer event persistence

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/lib/backgroundChatEvents.ts`

**Interfaces:**
- Consumes: `assistant_done.reasoningEffort`

- [ ] **Step 1: `App.tsx` streaming assistant close**

In the `assistant_done` handler, when updating `last` streaming assistant:

```ts
              reasoningEffort: event.reasoningEffort ?? last.reasoningEffort,
```

In the `else if (event.content)` push branch:

```ts
              reasoningEffort: event.reasoningEffort,
```

- [ ] **Step 2: `backgroundChatEvents.ts`**

Mirror the same two fields in both branches of the `assistant_done` handler (same pattern as `tokenUsage` / `multiCallTurn`).

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/lib/backgroundChatEvents.ts
git commit -m "feat: persist reasoning effort on assistant uiMessages"
```

---

### Task 7: Stream meta test script

**Files:**
- Create: `scripts/test-reasoning-effort-stream-meta.mjs`
- Modify: `package.json` (add script entry)

**Interfaces:**
- Consumes: `resolveReasoningEffortForRequest` from compiled/shared path via dynamic import

- [ ] **Step 1: Add test script**

Create `scripts/test-reasoning-effort-stream-meta.mjs` (same Vite SSR import pattern as `scripts/test-normalize-markdown.mjs`):

```js
import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const { resolveReasoningEffortForRequest } = await server.ssrLoadModule(
  new URL('../src/shared/reasoning-effort.ts', import.meta.url).pathname
)
after(() => server.close())

test('tools force none on reasoning models', () => {
  assert.equal(
    resolveReasoningEffortForRequest({
      model: 'gpt-5',
      hasTools: true,
      preference: 'high'
    }),
    'none'
  )
})

test('no tools uses preference', () => {
  assert.equal(
    resolveReasoningEffortForRequest({
      model: 'gpt-5',
      hasTools: false,
      preference: 'medium'
    }),
    'medium'
  )
})

test('non-reasoning model omits effort', () => {
  assert.equal(
    resolveReasoningEffortForRequest({
      model: 'gpt-4o',
      hasTools: false,
      preference: 'low'
    }),
    undefined
  )
})
```

- [ ] **Step 2: Add npm script**

In `package.json` `"scripts"`:

```json
"test:reasoning-effort-meta": "node --test scripts/test-reasoning-effort-stream-meta.mjs"
```

- [ ] **Step 3: Run test**

Run: `npm run test:reasoning-effort-meta`  
Expected: 3 passing tests

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/test-reasoning-effort-stream-meta.mjs package.json
git commit -m "test: add reasoning effort stream meta resolution checks"
```

---

### Task 8: Manual verification

- [ ] **Step 1: OpenAI reasoning model, no tools**

Set effort to `medium` in chat; send a message. Assistant `MessageMeta` should show `medium`.

- [ ] **Step 2: Tool turn**

Enable an MCP tool; send a message on a reasoning model. Last call with tools should show `none` in meta.

- [ ] **Step 3: Ollama**

Reply meta should not include an effort segment.

- [ ] **Step 4: Session reload**

Switch away and back (or restart app); historical assistant row still shows effort.

---

## Spec coverage (self-review)

| Spec requirement | Task |
| --- | --- |
| Last-call API effort | Task 4 |
| `reasoningEffortSent` on stream result | Tasks 2–3 |
| `assistant_done` + `UiMessage` fields | Task 1, 6 |
| Inline C1 label | Task 5 |
| Omit non-reasoning / Ollama | Tasks 2–3 (undefined), Task 5 (no render) |
| `backgroundChatEvents` parity | Task 6 |
| Persistence on reload | Task 6 |
| No tooltip breakdown | (not implemented) |
| Testing | Tasks 7–8 |
