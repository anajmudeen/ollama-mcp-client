# Ollama offline Models banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one shared Ollama-offline message on Models → Ollama when disconnected, and disable Download/Pull until Ollama is online.

**Architecture:** Export `OLLAMA_OFFLINE_USER_MESSAGE` from `src/shared/ollama-offline-message.ts`; wire `chat-provider-banners.ts` to that constant; render the same line in `ModelsPage` with an optional second hint line; gate buttons and pull handlers on `ollamaOk`.

**Tech Stack:** TypeScript, React 19, Electron renderer, Node `node:test` + Vite SSR for shared module tests.

## Global Constraints

- Canonical copy: `Ollama is offline — check Settings or switch to OpenAI.` (verbatim).
- Banner when `tab === 'ollama'` and `ollamaOk === false`; both All models and Installed sub-views.
- Models second line (optional): pull/download disabled hint; must not replace canonical first line.
- Settings: no change to Connected/Offline + `ollamaError`.
- Refresh / Delete / Use in chat: out of scope.
- Download `title` when offline: `OLLAMA_OFFLINE_USER_MESSAGE`.
- Run `npm run typecheck` after implementation.

---

## File map

| File | Role |
| --- | --- |
| `src/shared/ollama-offline-message.ts` | Canonical user-facing offline string |
| `src/shared/chat-provider-banners.ts` | Import constant for native Ollama offline banner |
| `src/renderer/src/components/ModelsPage.tsx` | Tab banner, button disable, handler guards |
| `scripts/test-ollama-offline-message.mjs` | Assert constant ↔ chat banner parity |
| `package.json` | `test:ollama-offline-message` script |

---

### Task 1: Shared offline message constant

**Files:**
- Create: `src/shared/ollama-offline-message.ts`
- Modify: `src/shared/chat-provider-banners.ts`

**Interfaces:**
- Produces: `export const OLLAMA_OFFLINE_USER_MESSAGE: string`

- [ ] **Step 1: Create `ollama-offline-message.ts`**

```ts
/** User-facing line when Ollama is unreachable (Chat, Models, tooltips). */
export const OLLAMA_OFFLINE_USER_MESSAGE =
  'Ollama is offline — check Settings or switch to OpenAI.'
```

- [ ] **Step 2: Use constant in `chat-provider-banners.ts`**

```ts
import { OLLAMA_OFFLINE_USER_MESSAGE } from './ollama-offline-message'
// ...
if (effectiveProvider === 'ollama' && !ollamaOk) {
  banners.push(OLLAMA_OFFLINE_USER_MESSAGE)
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/shared/ollama-offline-message.ts src/shared/chat-provider-banners.ts
git commit -m "feat: centralize Ollama offline user message"
```

---

### Task 2: Unit test for message parity

**Files:**
- Create: `scripts/test-ollama-offline-message.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `OLLAMA_OFFLINE_USER_MESSAGE`, `chatProviderReadinessBanners`

- [ ] **Step 1: Add test script**

```json
"test:ollama-offline-message": "node --test scripts/test-ollama-offline-message.mjs"
```

- [ ] **Step 2: Create `scripts/test-ollama-offline-message.mjs`**

```js
import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const msgMod = await server.ssrLoadModule(
  new URL('../src/shared/ollama-offline-message.ts', import.meta.url).pathname
)
const bannerMod = await server.ssrLoadModule(
  new URL('../src/shared/chat-provider-banners.ts', import.meta.url).pathname
)
after(() => server.close())

test('OLLAMA_OFFLINE_USER_MESSAGE matches native Ollama offline chat banner', () => {
  const banners = bannerMod.chatProviderReadinessBanners({
    configuredProvider: 'ollama',
    effectiveProvider: 'ollama',
    ollamaOk: false
  })
  assert.deepEqual(banners, [msgMod.OLLAMA_OFFLINE_USER_MESSAGE])
})
```

- [ ] **Step 3: Run test**

Run: `npm run test:ollama-offline-message`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/test-ollama-offline-message.mjs package.json
git commit -m "test: Ollama offline message matches chat banner"
```

---

### Task 3: Models page banner and pull/download gating

**Files:**
- Modify: `src/renderer/src/components/ModelsPage.tsx`

**Interfaces:**
- Consumes: `OLLAMA_OFFLINE_USER_MESSAGE` from `../../../shared/ollama-offline-message`

- [ ] **Step 1: Import constant**

```ts
import { OLLAMA_OFFLINE_USER_MESSAGE } from '../../../shared/ollama-offline-message'
```

- [ ] **Step 2: Guard handlers**

At start of `handlePull` and `handleDownloadFromList`:

```ts
if (!ollamaOk) return
```

- [ ] **Step 3: Add Ollama-tab banner** (inside `tab === 'ollama'` branch, first child of the `space-y-4` wrapper ~line 851, before All/Installed toggle)

```tsx
{!ollamaOk && (
  <p className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
    <span className="block">{OLLAMA_OFFLINE_USER_MESSAGE}</span>
    <span className="mt-1 block text-amber-200/80">
      Pull and download are disabled until Ollama is running.
    </span>
  </p>
)}
```

- [ ] **Step 4: Remove Installed-only duplicate banner** (the block that only says installed models cannot be refreshed).

- [ ] **Step 5: Disable Download button**

```tsx
disabled={Boolean(pulling) || !ollamaOk}
title={!ollamaOk ? OLLAMA_OFFLINE_USER_MESSAGE : 'Download smallest local tag (or :latest)'}
```

- [ ] **Step 6: Disable Pull button**

```tsx
disabled={Boolean(pulling) || installed || !ollamaOk}
title={!ollamaOk ? OLLAMA_OFFLINE_USER_MESSAGE : undefined}
```

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/ModelsPage.tsx
git commit -m "feat: Ollama offline banner and disabled pull on Models"
```

---

### Task 4: Regression tests

- [ ] **Step 1: Run existing banner tests**

Run: `node --test scripts/test-chat-provider-banners.mjs`
Expected: PASS (native Ollama offline test unchanged semantically)

- [ ] **Step 2: Manual smoke** (optional): stop Ollama, confirm banner on All + Installed, buttons disabled.
