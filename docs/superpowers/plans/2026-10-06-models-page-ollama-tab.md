# Models page Ollama tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Installed + library tabs with a single **Ollama** tab: library browse by default (installed badge + installed-first sort), **Installed** as an in-tab filter showing families grouped by base name, shared capability chips, README only on Ollama detail panels.

**Architecture:** Refactor `ModelsPage.tsx` tab model to `ollama | openai | azure`, add `ollamaInstalledOnly` toggle and shared Ollama chrome; extract small pure helpers for family grouping and library partition sort; extend detail panel with `local-family` kind for multi-tag local detail.

**Tech Stack:** React 19, TypeScript, existing `window.api.ollama` IPC, `ModelsPage.tsx` (~1.3k lines).

## Global Constraints

- Top tabs: **Ollama** · **OpenAI** · **Azure OpenAI** (cloud tabs only when provider enabled). No **Installed** or **library** tab labels.
- Ollama default view: **library browse** (All models). **Installed** is a filter toggle, not a tab.
- Browse: keep **Installed** badge on library cards (already present); **stable sort** — installed families first, preserve order within each partition.
- Installed filter: **one row per family** (`localBaseName`); tags and actions in detail panel.
- Capability chips apply in **both** browse and Installed filter modes.
- README only for Ollama detail (`local`, `local-family`, `remote`). OpenAI/Azure unchanged, no README.
- Run `npm run typecheck` after each task.

---

## File map

| File | Role |
| --- | --- |
| `src/renderer/src/lib/ollamaModelFamilies.ts` | Pure helpers: group by base, cap match, library installed-first partition |
| `src/renderer/src/components/ModelsPage.tsx` | Tabs, Ollama toggle, lists, detail panel |
| `scripts/test-ollama-model-families.mjs` | Node tests for helpers (Vite SSR import) |
| `package.json` | `test:ollama-model-families` script |

---

### Task 1: Family grouping helpers

**Files:**
- Create: `src/renderer/src/lib/ollamaModelFamilies.ts`
- Create: `scripts/test-ollama-model-families.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `localBaseName`, `groupLocalModelsByFamily`, `familyMatchesCapability`, `partitionLibraryInstalledFirst`

- [ ] **Step 1: Create `ollamaModelFamilies.ts`**

```ts
import type { LibraryCapability, LibraryModelSummary, OllamaModel } from '../../../shared/types'

export function localBaseName(name: string): string {
  return name.split(':')[0] ?? name
}

export interface LocalModelFamily {
  base: string
  tags: OllamaModel[]
}

export function groupLocalModelsByFamily(models: OllamaModel[]): LocalModelFamily[] {
  const byBase = new Map<string, OllamaModel[]>()
  for (const m of models) {
    const base = localBaseName(m.name)
    const list = byBase.get(base)
    if (list) list.push(m)
    else byBase.set(base, [m])
  }
  return [...byBase.entries()]
    .map(([base, tags]) => ({ base, tags: [...tags].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.base.localeCompare(b.base))
}

/** Match library cap or legacy installed cap string (e.g. image). */
export function familyMatchesCapability(
  family: LocalModelFamily,
  cap: LibraryCapability | string | null
): boolean {
  if (!cap) return true
  return family.tags.some((m) => {
    const caps = m.capabilities ?? []
    const tags = m.tags ?? []
    return caps.includes(cap) || tags.includes(cap)
  })
}

export function isInstalledFamily(local: OllamaModel[], libraryName: string): boolean {
  return local.some((m) => localBaseName(m.name) === libraryName)
}

/** Stable: installed families first, then others; preserve relative order in each bucket. */
export function partitionLibraryInstalledFirst(
  list: LibraryModelSummary[],
  local: OllamaModel[]
): LibraryModelSummary[] {
  const installed: LibraryModelSummary[] = []
  const rest: LibraryModelSummary[] = []
  for (const m of list) {
    if (isInstalledFamily(local, m.name)) installed.push(m)
    else rest.push(m)
  }
  return [...installed, ...rest]
}
```

- [ ] **Step 2: Add test script**

`scripts/test-ollama-model-families.mjs` — Vite SSR load module (same pattern as `scripts/test-reasoning-effort-stream-meta.mjs`):

- `groupLocalModelsByFamily` merges `llama3:8b` and `llama3:latest` under `llama3`
- `partitionLibraryInstalledFirst` puts installed name first
- `familyMatchesCapability` returns true when any tag has capability

- [ ] **Step 3: Add npm script**

```json
"test:ollama-model-families": "node --test scripts/test-ollama-model-families.mjs"
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run test:ollama-model-families`  
Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/ollamaModelFamilies.ts scripts/test-ollama-model-families.mjs package.json
git commit -m "feat: add Ollama local model family grouping helpers"
```

---

### Task 2: Tab model and library load gating

**Files:**
- Modify: `src/renderer/src/components/ModelsPage.tsx`

**Interfaces:**
- Consumes: helpers from `ollamaModelFamilies.ts` (import `localBaseName`, `isInstalledFamily`, `partitionLibraryInstalledFirst` — remove duplicate `localBaseName` / `isInstalledFamily` from file bottom once imported)

- [ ] **Step 1: Change tab type and default**

```ts
type ModelsTab = 'ollama' | 'openai' | 'azure'
```

```ts
const [tab, setTab] = useState<ModelsTab>('ollama')
```

```ts
const tabIds = [
  'ollama',
  ...(openaiEnabled ? ['openai'] : []),
  ...(azureOpenaiEnabled ? ['azure'] : [])
] as ModelsTab[]
```

Tab button label: `id === 'ollama' ? 'Ollama' : ...` (keep OpenAI / Azure labels).

- [ ] **Step 2: Update header subtitle**

Replace library/installed wording with Ollama + cloud catalogs (one line).

- [ ] **Step 3: Gate library effects on Ollama browse**

Replace every `tab !== 'library'` / `tab === 'library'` with:

- Load library / infinite scroll / scroll reset when: `tab === 'ollama' && !ollamaInstalledOnly`
- Add state: `const [ollamaInstalledOnly, setOllamaInstalledOnly] = useState(false)`

(Declare `ollamaInstalledOnly` near other Ollama state.)

- [ ] **Step 4: Apply installed-first partition after library merge**

In `loadLibraryPage`, after `sortLibraryModels(merged)`:

```ts
return partitionLibraryInstalledFirst(sortLibraryModels(merged), models)
```

Pass `models` from component scope into `loadLibraryPage` dependency array.

- [ ] **Step 5: Run typecheck**

Expected: FAIL until Task 3 removes `tab === 'installed'` branch — complete Task 3 in same commit or fix branch to `tab === 'ollama'` placeholder.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ModelsPage.tsx
git commit -m "refactor: Models page Ollama tab and library gating"
```

---

### Task 3: Ollama unified chrome and Installed filter list

**Files:**
- Modify: `src/renderer/src/components/ModelsPage.tsx`

**Interfaces:**
- Consumes: `groupLocalModelsByFamily`, `familyMatchesCapability`, `LocalModelFamily`
- Produces: grouped family list UI; view toggle `All models` | `Installed`

- [ ] **Step 1: Unify capability state (optional simplification)**

Replace separate `libraryCap` and `installedCap` with single `ollamaCap: LibraryCapability | null` used whenever `tab === 'ollama'`. Wire `LIBRARY_FILTERS` chips to `ollamaCap`. For Installed filter, also show **image** chip if today’s installed UI had it (add `{ id: 'image', label: 'Image' }` only in Installed mode or always — prefer always as extra chip next to `LIBRARY_FILTERS`).

- [ ] **Step 2: View toggle in Ollama toolbar**

Segmented control or chips:

- **All models** → `setOllamaInstalledOnly(false)`
- **Installed** → `setOllamaInstalledOnly(true)`

Place above search (browse) or above installed search row.

- [ ] **Step 3: Replace `tab === 'installed'` branch**

When `tab === 'ollama' && ollamaInstalledOnly`:

- Reuse offline banner from old installed branch.
- Search: filter families by `base` (and tag name substring).
- Sort families: name / smallest / largest using min/max `tag.size` in family (reuse `InstalledSort` logic on families).
- Pagination: `PAGE_SIZE` on **families** not raw tags.
- List row: family `base`, `{tags.length} tags`, summary size line, Active badge if any tag === `selectedModel`.
- Row click → `void openLocalFamilyDetail(family.base)` (Task 4).

When `tab === 'ollama' && !ollamaInstalledOnly`:

- Keep existing library form + chips + list (already under former `library` else branch).

When `tab === 'openai' | 'azure'`:

- Unchanged.

- [ ] **Step 4: `filteredFamilies` useMemo**

```ts
const filteredFamilies = useMemo(() => {
  let families = groupLocalModelsByFamily(models)
  const q = installedQuery.trim().toLowerCase()
  if (q) {
    families = families.filter(
      (f) =>
        f.base.toLowerCase().includes(q) ||
        f.tags.some((t) => t.name.toLowerCase().includes(q))
    )
  }
  families = families.filter((f) => familyMatchesCapability(f, ollamaCap))
  // sort by installedSort on families ...
  return families
}, [models, installedQuery, ollamaCap, installedSort])
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`  
Expected: PASS (detail handler may stub until Task 4).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ModelsPage.tsx
git commit -m "feat: Ollama tab with Installed filter and family list"
```

---

### Task 4: Family detail panel and README scope

**Files:**
- Modify: `src/renderer/src/components/ModelsPage.tsx`

**Interfaces:**
- Produces: `detailKind: 'local' | 'local-family' | 'remote' | null`
- Produces: `openLocalFamilyDetail(base: string)`

- [ ] **Step 1: Extend detail kind**

```ts
const [detailKind, setDetailKind] = useState<'local' | 'local-family' | 'remote' | null>(null)
const [familyTags, setFamilyTags] = useState<OllamaModel[]>([])
```

- [ ] **Step 2: Implement `openLocalFamilyDetail`**

```ts
const openLocalFamilyDetail = async (base: string): Promise<void> => {
  const requestId = ++detailRequestRef.current
  const tags = models.filter((m) => localBaseName(m.name) === base)
  setDetailKind('local-family')
  setDetailName(base)
  setFamilyTags(tags)
  setLocalDetail(null)
  setRemoteDetail(null)
  setReadmeMd(null)
  setReadmeMissing(false)
  setReadmeLoading(true)
  setDetailLoading(false)
  setDetailError(null)
  try {
    const readme = await window.api.ollama.getLibraryReadme(base).catch(() => undefined)
    if (requestId !== detailRequestRef.current) return
    setReadmeMd(readme ?? null)
    setReadmeMissing(!readme)
  } finally {
    if (requestId === detailRequestRef.current) setReadmeLoading(false)
  }
}
```

- [ ] **Step 3: Aside subtitle**

```tsx
{detailKind === 'remote' ? 'Ollama library' : 'Ollama'}
```

(or single label **Ollama** for all three kinds per spec).

- [ ] **Step 4: Render `local-family` panel**

- Family title = `detailName` (base).
- README block (same markup as local detail).
- `<ul>` of tags: name, size, modified, **Use in chat**, **Delete** (reuse `handleDelete`; after delete refresh `familyTags` from `models` or close if empty).
- Optional: click tag name → `openLocalDetail(tag.name)` for full showModel fields.

- [ ] **Step 5: `closeDetail` clears `familyTags`**

- [ ] **Step 6: `handleDelete` when family detail**

If `detailKind === 'local-family'` and no tags remain for base after refresh, `closeDetail()`.

- [ ] **Step 7: Run typecheck**

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/ModelsPage.tsx
git commit -m "feat: Ollama family detail panel with README"
```

---

### Task 5: Cleanup and manual QA

**Files:**
- Modify: `src/renderer/src/components/ModelsPage.tsx` (remove dead duplicates)

- [ ] **Step 1: Remove duplicate `localBaseName` / `isInstalledFamily` from ModelsPage if fully imported from lib**

- [ ] **Step 2: Verify OpenAI/Azure sections have no README aside** (should already be list-only)

- [ ] **Step 3: Run typecheck and family tests**

Run: `npm run typecheck && npm run test:ollama-model-families`

- [ ] **Step 4: Manual checklist**

- Tabs: Ollama, OpenAI, Azure only.
- Ollama default: library browse; Installed badge on cards; installed rows above others.
- Installed filter: families grouped; detail shows tags + README.
- Capability chips filter both modes.
- README absent on OpenAI/Azure.

- [ ] **Step 5: Commit** (if cleanup only)

```bash
git add src/renderer/src/components/ModelsPage.tsx
git commit -m "chore: dedupe Ollama family helpers on Models page"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
| --- | --- |
| Ollama tab replaces Installed + library | Task 2 |
| Installed filter, family rows | Task 3 |
| Badge + installed-first browse | Task 2 (partition; badge exists) |
| Capability chips both modes | Task 3 |
| README Ollama only | Task 4 |
| Family detail tags inside | Task 4 |
| OpenAI/Azure unchanged | Task 3 branch isolation |
