# Reasoning Effort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted in-chat reasoning effort control (`none`/`low`/`medium`/`high`, default `low`) for OpenAI and Azure Chat Completions, forcing `none` when tools are present.

**Architecture:** Store `reasoningEffort` in electron-store like `showThinking`. A pure helper resolves the body field from model id, tool presence, and preference. OpenAI/Azure clients call that helper; Chat shows a compact Effort menu beside the model picker when the selected model is reasoning-capable.

**Tech Stack:** Electron config/IPC, React Chat composer, existing `openAiModelUsesReasoningEffort`, `node:test` + Vite SSR scripts.

## Global Constraints

- Stay on Chat Completions — no Responses API migration.
- Values: `none` | `low` | `medium` | `high`; default `low`.
- One global preference for OpenAI + Azure.
- When tools are present on a reasoning model, request uses `none` (UI preference unchanged).
- Omit `reasoning_effort` for non-reasoning models and for Ollama.
- Invalid/missing stored values coerce to `low`.

## File map

- Create: `src/shared/reasoning-effort.ts` — type helpers, normalize, resolve for request body, UI visibility
- Modify: `src/shared/types.ts` — `ReasoningEffort` on `AppConfig`
- Modify: `src/main/config-store.ts` — get/set + default
- Modify: `src/main/ipc.ts`, `src/preload/index.ts` — `config:setReasoningEffort`
- Modify: `src/main/openai-client.ts`, `src/main/azure-openai-client.ts` — apply resolved effort
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/components/Chat.tsx` — state + Effort control
- Test: `scripts/test-reasoning-effort.mjs`
- Spec: `docs/superpowers/specs/2026-09-29-reasoning-effort-design.md`

---

### Task 1: Shared reasoning-effort helpers

**Files:**
- Create: `src/shared/reasoning-effort.ts`
- Modify: `src/shared/types.ts` (export type if preferred from shared)
- Test: `scripts/test-reasoning-effort.mjs`

**Interfaces:**
- Produces:
  - `export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high'`
  - `export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'low'`
  - `export function normalizeReasoningEffort(value: unknown): ReasoningEffort`
  - `export function resolveReasoningEffortForRequest(options: { model: string; hasTools: boolean; preference: ReasoningEffort }): ReasoningEffort | undefined`
  - `export function shouldShowReasoningEffortControl(options: { provider: 'ollama' | 'openai' | 'azure-openai'; model: string | null }): boolean`

- [ ] **Step 1: Write the failing test**

```js
// scripts/test-reasoning-effort.mjs
import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const mod = await server.ssrLoadModule(
  new URL('../src/shared/reasoning-effort.ts', import.meta.url).pathname
)
after(() => server.close())

test('normalizeReasoningEffort defaults and coerces', () => {
  assert.equal(mod.normalizeReasoningEffort(undefined), 'low')
  assert.equal(mod.normalizeReasoningEffort('medium'), 'medium')
  assert.equal(mod.normalizeReasoningEffort('nope'), 'low')
  assert.equal(mod.DEFAULT_REASONING_EFFORT, 'low')
})

test('resolveReasoningEffortForRequest follows omit / none-with-tools / preference', () => {
  assert.equal(
    mod.resolveReasoningEffortForRequest({
      model: 'gpt-4o',
      hasTools: false,
      preference: 'high'
    }),
    undefined
  )
  assert.equal(
    mod.resolveReasoningEffortForRequest({
      model: 'gpt-5',
      hasTools: true,
      preference: 'high'
    }),
    'none'
  )
  assert.equal(
    mod.resolveReasoningEffortForRequest({
      model: 'gpt-5',
      hasTools: false,
      preference: 'medium'
    }),
    'medium'
  )
  assert.equal(
    mod.resolveReasoningEffortForRequest({
      model: 'o3-mini',
      hasTools: false,
      preference: 'low'
    }),
    'low'
  )
})

test('shouldShowReasoningEffortControl', () => {
  assert.equal(
    mod.shouldShowReasoningEffortControl({ provider: 'ollama', model: 'gpt-5' }),
    false
  )
  assert.equal(
    mod.shouldShowReasoningEffortControl({ provider: 'openai', model: 'gpt-4o' }),
    false
  )
  assert.equal(
    mod.shouldShowReasoningEffortControl({ provider: 'openai', model: 'gpt-5' }),
    true
  )
  assert.equal(
    mod.shouldShowReasoningEffortControl({
      provider: 'azure-openai',
      model: 'o3-mini'
    }),
    true
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-reasoning-effort.mjs`  
Expected: FAIL — module missing.

- [ ] **Step 3: Implement helpers**

```ts
// src/shared/reasoning-effort.ts
import { openAiModelUsesReasoningEffort } from '../main/openai-client'
```

**Do not import from main into shared.** Instead move or duplicate the capability check:

Prefer exporting `openAiModelUsesReasoningEffort` from `src/shared/openai-models.ts` (or copy the existing function body into `reasoning-effort.ts` and re-export from `openai-client.ts` for backward compatibility).

```ts
import type { LlmProvider } from './types'

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high'
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'low'
const ALLOWED = new Set<ReasoningEffort>(['none', 'low', 'medium', 'high'])

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return typeof value === 'string' && ALLOWED.has(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : DEFAULT_REASONING_EFFORT
}

export function resolveReasoningEffortForRequest(options: {
  model: string
  hasTools: boolean
  preference: ReasoningEffort
}): ReasoningEffort | undefined {
  if (!openAiModelUsesReasoningEffort(options.model)) return undefined
  if (options.hasTools) return 'none'
  return normalizeReasoningEffort(options.preference)
}

export function shouldShowReasoningEffortControl(options: {
  provider: LlmProvider
  model: string | null
}): boolean {
  if (options.provider === 'ollama') return false
  if (!options.model?.trim()) return false
  return openAiModelUsesReasoningEffort(options.model)
}
```

If `openAiModelUsesReasoningEffort` currently lives only in `openai-client.ts`, move the function body to `src/shared/openai-models.ts` (or `reasoning-effort.ts`) and make `openai-client.ts` re-export it so Azure client imports keep working.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-reasoning-effort.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/reasoning-effort.ts src/shared/openai-models.ts src/main/openai-client.ts scripts/test-reasoning-effort.mjs
git commit -m "$(cat <<'EOF'
feat: add shared reasoning effort helpers

Normalize preference, resolve request body value, and decide when the
chat Effort control should show.
EOF
)"
```

---

### Task 2: Persist reasoningEffort in config + IPC

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/config-store.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Test: extend `scripts/test-reasoning-effort.mjs` for normalize via config if store loads; otherwise rely on Task 1 + typecheck

**Interfaces:**
- Produces:
  - `AppConfig.reasoningEffort: ReasoningEffort`
  - `getReasoningEffort(): ReasoningEffort`
  - `setReasoningEffort(value: ReasoningEffort): ReasoningEffort`
  - `window.api.setReasoningEffort(value): Promise<ReasoningEffort>`

- [ ] **Step 1: Add type + defaults**

In `types.ts`:

```ts
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high'
// on AppConfig:
reasoningEffort: ReasoningEffort
```

(Or re-export from `reasoning-effort.ts` in types to avoid duplicate type definitions — single source of truth in `reasoning-effort.ts`, import into `types.ts`.)

In `DEFAULT_CONFIG` / store defaults: `reasoningEffort: 'low'`.

- [ ] **Step 2: Implement get/set**

```ts
import {
  DEFAULT_REASONING_EFFORT,
  normalizeReasoningEffort,
  type ReasoningEffort
} from '../shared/reasoning-effort'

export function getReasoningEffort(): ReasoningEffort {
  return normalizeReasoningEffort(
    store.get('reasoningEffort', DEFAULT_REASONING_EFFORT)
  )
}

export function setReasoningEffort(value: ReasoningEffort): ReasoningEffort {
  const next = normalizeReasoningEffort(value)
  store.set('reasoningEffort', next)
  return next
}
```

Include `reasoningEffort: getReasoningEffort()` in `getConfig()`.

- [ ] **Step 3: IPC + preload**

```ts
// ipc.ts
ipcMain.handle('config:setReasoningEffort', (_e, value: ReasoningEffort) =>
  setReasoningEffort(value)
)

// preload
setReasoningEffort: (value: ReasoningEffort): Promise<ReasoningEffort> =>
  ipcRenderer.invoke('config:setReasoningEffort', value),
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`  
Expected: PASS (renderer may still not read the field until Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/config-store.ts src/main/ipc.ts src/preload/index.ts
git commit -m "$(cat <<'EOF'
feat: persist reasoningEffort in app config

Default to low and expose config:setReasoningEffort over IPC.
EOF
)"
```

---

### Task 3: Apply effort in OpenAI and Azure chat bodies

**Files:**
- Modify: `src/main/openai-client.ts`
- Modify: `src/main/azure-openai-client.ts`
- Test: `scripts/test-reasoning-effort.mjs` — unit-test a small exported `applyReasoningEffortToBody` or test via exporting `buildChatBody` logic

**Interfaces:**
- Consumes: `getReasoningEffort()`, `resolveReasoningEffortForRequest`
- Produces: chat completion JSON includes `reasoning_effort` per spec rules

- [ ] **Step 1: Export a pure apply helper (preferred for tests)**

In `src/shared/reasoning-effort.ts` (or keep resolve only):

Clients call:

```ts
const effort = resolveReasoningEffortForRequest({
  model: options.model, // or deployment
  hasTools: Boolean(options.tools?.length),
  preference: getReasoningEffort()
})
if (effort !== undefined) body.reasoning_effort = effort
```

Replace the old block that only set `'none'` when tools were present.

Apply in:
- `openAiChatStream` body construction
- `openAiChatOnce` if it builds a similar body with tools (match stream behavior for consistency)
- Azure `buildChatBody`

- [ ] **Step 2: Add client-facing test**

Extend `scripts/test-reasoning-effort.mjs` with cases that already cover resolve (Task 1). Optionally SSR-load openai-client only if electron-free; otherwise Task 1 resolve tests are sufficient when clients call the helper directly — verify by reading the call sites in self-review.

Add one integration-style assertion file only if the client exports a testable `buildOpenAiChatBody` — do **not** invent a large refactor. Minimal change: call `resolveReasoningEffortForRequest` at the three sites.

- [ ] **Step 3: Typecheck + existing Azure/OpenAI scripts that still pass**

```bash
node scripts/test-reasoning-effort.mjs
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/main/openai-client.ts src/main/azure-openai-client.ts
git commit -m "$(cat <<'EOF'
feat: send reasoning_effort on OpenAI and Azure chat requests

Use the user preference for tool-free reasoning models; force none when
tools are attached.
EOF
)"
```

---

### Task 4: In-chat Effort control

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Chat.tsx`

**Interfaces:**
- Consumes: `config.reasoningEffort`, `window.api.setReasoningEffort`, `shouldShowReasoningEffortControl`, `effectiveProvider`, `selectedModel`
- Produces: Effort dropdown beside model picker

- [ ] **Step 1: Wire App state**

```ts
const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('low')
// in applyConfig:
setReasoningEffort(normalizeReasoningEffort(config.reasoningEffort))

const handleSetReasoningEffort = async (value: ReasoningEffort): Promise<void> => {
  const saved = await window.api.setReasoningEffort(value)
  setReasoningEffort(saved)
}

// pass to Chat:
reasoningEffort={reasoningEffort}
onSetReasoningEffort={handleSetReasoningEffort}
effectiveProvider={effectiveProvider}
```

- [ ] **Step 2: Add Chat control beside model picker**

Near the model menu button (~line 1007 in `Chat.tsx`):

```tsx
{shouldShowReasoningEffortControl({
  provider: effectiveProvider,
  model: selectedModel
}) && (
  <div className="relative">
    <button type="button" /* same pill style as model */>
      Effort: {labelFor(reasoningEffort)}
    </button>
    {/* menu: None / Low / Medium / High → onSetReasoningEffort */}
  </div>
)}
```

Optional: if `effectiveProvider` is openai/azure and model is reasoning-capable, show a one-line muted note under the composer when tools are typically available — keep YAGNI: skip the note unless trivial; the force-`none` behavior is enough.

Close the effort menu when clicking outside (reuse model menu ref pattern or a second ref).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 4: Manual smoke (if app available)**

1. Select OpenAI `gpt-5` (or Azure reasoning deployment) → Effort control visible, default Low.
2. Change to High → restart app → still High.
3. Select `gpt-4o` or Ollama → control hidden.
4. Send a tool-using turn on a reasoning model → no 400 for effort+tools.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/Chat.tsx
git commit -m "$(cat <<'EOF'
feat: add in-chat reasoning effort control

Show Effort beside the model picker for OpenAI/Azure reasoning models
and persist the selection.
EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Default `low`, coerce invalid | Task 1–2 |
| Persist + IPC | Task 2 |
| Resolve omit / tools⇒none / preference | Task 1 + 3 |
| OpenAI + Azure bodies | Task 3 |
| In-chat control + visibility | Task 4 |
| No Responses / Ollama unchanged | (no task — do not touch) |

## Self-review notes

- Keep `openAiModelUsesReasoningEffort` importable from shared (no shared→main dependency).
- Do not rename IPC channels unrelated to this feature.
- Title-generation / non-stream helpers: apply the same resolve rules if they accept tools; otherwise leave unchanged.
