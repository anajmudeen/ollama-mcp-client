# Azure OpenAI Deployments-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Azure OpenAI model catalog UI, persistence, and deployment metadata matching so only manually managed deployments remain.

**Architecture:** Keep `GET …/openai/models` as a validate-only credential probe that discards the response body. Config always exposes an empty catalog and strips `matchedCatalogMetadata`. The Azure Models tab and LLM provider use enabled deployments only, with vision hints from deployment-name heuristics.

**Tech Stack:** Electron main/preload IPC, React Models page, electron-store, existing `azure-openai-client` / `azure-openai-provider`, `node:test` + Vite SSR scripts.

## Global Constraints

- Azure model management is deployments only — do not show, persist, or decorate with catalog data.
- Validation keeps `GET …/openai/models` and discards the body (no `mergeAzureOpenaiCatalog`).
- OpenAI (non-Azure) catalog UX is unchanged.
- Chat still uses deployment-in-path URLs; image gen for Azure stays unsupported.
- Existing manually entered deployments must survive upgrade (metadata-only fields stripped).

## File map

- Modify: `src/shared/types.ts` — optional cleanup of `matchedCatalogMetadata` / status fields
- Modify: `src/main/config-store.ts` — clear catalog on read/write paths; strip deployment metadata; retire merge
- Modify: `src/main/ipc.ts` — validate without catalog merge; `catalogCount: 0`
- Modify: `src/main/llm/azure-openai-provider.ts` — deployment-name heuristics only
- Modify: `src/renderer/src/components/ModelsPage.tsx` — deployments-only Azure tab
- Modify: `src/renderer/src/App.tsx` — drop catalog state/props
- Test: `scripts/test-azure-deployments-only.mjs` (new) and/or extend existing Azure scripts
- Spec already landed: `docs/superpowers/specs/2026-09-29-azure-deployments-only-design.md`

---

### Task 1: Clear catalog persistence and strip deployment metadata

**Files:**
- Modify: `src/main/config-store.ts`
- Modify: `src/shared/types.ts` (keep `matchedCatalogMetadata?` optional for one release if needed, but stop writing it)
- Test: `scripts/test-azure-deployments-only.mjs`

**Interfaces:**
- Consumes: existing `getAzureOpenaiDeployments`, `AzureOpenaiDeploymentEntry`
- Produces:
  - `getAzureOpenaiModelsCatalog(): AzureOpenaiModelEntry[]` always returns `[]` and clears stored catalog when non-empty
  - `normalizeAzureDeploymentEntry(deployment): { name: string; enabled: boolean }` strips metadata
  - `mergeAzureOpenaiCatalog` removed or becomes a no-op that clears catalog and strips metadata from deployments

- [ ] **Step 1: Write the failing test**

Create `scripts/test-azure-deployments-only.mjs` following the Vite SSR + `node:test` pattern in `scripts/test-config-store-migrations.mjs`.

```js
import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const store = await server.ssrLoadModule(
  new URL('../src/main/config-store.ts', import.meta.url).pathname
)
after(() => server.close())

test('getAzureOpenaiModelsCatalog always returns empty and clears store', () => {
  store.setAzureOpenaiModelsCatalog([{ id: 'gpt-4o', capabilities: ['chat'] }])
  assert.deepEqual(store.getAzureOpenaiModelsCatalog(), [])
  assert.deepEqual(store.getAzureOpenaiModelsCatalog(), [])
})

test('deployments read/write strip matchedCatalogMetadata', () => {
  // reset via remove all then add
  for (const d of store.getAzureOpenaiDeployments()) {
    store.removeAzureOpenaiDeployment(d.name)
  }
  store.addAzureOpenaiDeployment({
    name: 'my-gpt4o',
    enabled: true,
    matchedCatalogMetadata: { id: 'gpt-4o', capabilities: ['vision'] }
  })
  const listed = store.getAzureOpenaiDeployments()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].name, 'my-gpt4o')
  assert.equal(listed[0].enabled, true)
  assert.equal('matchedCatalogMetadata' in listed[0], false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-azure-deployments-only.mjs`

Expected: FAIL — catalog still returned / metadata still present (or sandbox EPERM on electron-store; if EPERM, re-run with full permissions / `all`).

- [ ] **Step 3: Implement minimal config-store changes**

In `config-store.ts`:

```ts
export function getAzureOpenaiModelsCatalog(): AzureOpenaiModelEntry[] {
  const stored = store.get('azureOpenaiModelsCatalog', DEFAULT_CONFIG.azureOpenaiModelsCatalog)
  if (Array.isArray(stored) && stored.length > 0) {
    store.set('azureOpenaiModelsCatalog', [])
  }
  return []
}

export function setAzureOpenaiModelsCatalog(
  _entries: AzureOpenaiModelEntry[]
): AzureOpenaiModelEntry[] {
  store.set('azureOpenaiModelsCatalog', [])
  return []
}

function normalizeAzureDeployment(
  deployment: AzureOpenaiDeploymentEntry
): AzureOpenaiDeploymentEntry {
  return {
    name: deployment.name.trim(),
    enabled: Boolean(deployment.enabled)
  }
}

export function getAzureOpenaiDeployments(): AzureOpenaiDeploymentEntry[] {
  const raw = store.get('azureOpenaiDeployments', DEFAULT_CONFIG.azureOpenaiDeployments)
  const normalized = raw.map(normalizeAzureDeployment)
  // Persist strip if any entry still carried metadata
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
    store.set('azureOpenaiDeployments', normalized)
  }
  return [...normalized]
}

// Delete mergeAzureOpenaiCatalog entirely, or replace with:
export function clearAzureOpenaiCatalog(): void {
  store.set('azureOpenaiModelsCatalog', [])
  store.set(
    'azureOpenaiDeployments',
    getAzureOpenaiDeployments().map(normalizeAzureDeployment)
  )
}
```

Update all call sites of `mergeAzureOpenaiCatalog` in Task 2 (temporarily leave the export as a deprecated clear if needed to keep typecheck green until Task 2).

Prefer deleting `mergeAzureOpenaiCatalog` and fixing IPC in the same commit if typecheck would fail otherwise — fold the IPC stub into this task only if required for compile; otherwise Task 2.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-azure-deployments-only.mjs`  
Expected: PASS

Also run: `npm run typecheck`  
Expected: pass (or only failures from remaining `mergeAzureOpenaiCatalog` imports — fix those next).

- [ ] **Step 5: Commit**

```bash
git add scripts/test-azure-deployments-only.mjs src/main/config-store.ts src/shared/types.ts
git commit -m "$(cat <<'EOF'
feat: stop persisting Azure OpenAI model catalog

Always expose an empty catalog and strip matchedCatalogMetadata from
deployments so Azure config is deployments-only.
EOF
)"
```

---

### Task 2: Validate without storing catalog

**Files:**
- Modify: `src/main/ipc.ts` (`validateAzureOpenaiAndFetchCatalog`, `getAzureOpenaiStatus`)
- Test: extend `scripts/test-azure-deployments-only.mjs` or assert via a small pure helper if IPC is hard to load under SSR

**Interfaces:**
- Consumes: `fetchAzureModels` / `validateAzureOpenai` from `azure-openai-client.ts`
- Produces: `validateAzureOpenaiCredentials(): Promise<AppConfig>` that sets validation flags only; `AzureOpenaiStatus.catalogCount` always `0`

- [ ] **Step 1: Write the failing assertion**

Add to the test script (or a focused unit on a extracted helper). Prefer extracting the post-validate persistence rule into a tiny pure function if IPC cannot load under Vite SSR:

```ts
// src/shared/azure-openai-status.ts (optional; only if needed for testability)
export function azureOpenaiStatusCounts(deployments: { enabled: boolean }[]): {
  catalogCount: number
  enabledCount: number
  deploymentCount: number
  enabledDeploymentCount: number
} {
  const enabled = deployments.filter((d) => d.enabled).length
  return {
    catalogCount: 0,
    enabledCount: enabled,
    deploymentCount: deployments.length,
    enabledDeploymentCount: enabled
  }
}
```

Test:

```js
test('azure status counts never report catalog', async () => {
  const mod = await server.ssrLoadModule(
    new URL('../src/shared/azure-openai-status.ts', import.meta.url).pathname
  )
  assert.deepEqual(
    mod.azureOpenaiStatusCounts([{ enabled: true }, { enabled: false }]),
    {
      catalogCount: 0,
      enabledCount: 1,
      deploymentCount: 2,
      enabledDeploymentCount: 1
    }
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-azure-deployments-only.mjs`  
Expected: FAIL until helper exists / status still uses catalog length.

- [ ] **Step 3: Implement IPC validate-only path**

Rename and rewrite in `ipc.ts`:

```ts
async function validateAzureOpenaiCredentials(): Promise<ReturnType<typeof getConfig>> {
  const generation = ++azureValidationGeneration
  const isCurrent = (): boolean => generation === azureValidationGeneration
  const apiKey = getAzureOpenaiApiKey()
  const endpoint = getAzureOpenaiEndpoint()
  const apiVersion = getAzureOpenaiApiVersion()
  if (!apiKey) {
    if (isCurrent()) setAzureOpenaiValidationOk(false, 'API key not configured')
    return getConfig()
  }
  if (!endpoint || !normalizeAzureEndpoint(endpoint)) {
    if (isCurrent()) setAzureOpenaiValidationOk(false, 'Service endpoint not configured')
    return getConfig()
  }
  if (!apiVersion.trim()) {
    if (isCurrent()) setAzureOpenaiValidationOk(false, 'API version not configured')
    return getConfig()
  }

  try {
    await fetchAzureModels({ apiKey, endpoint, apiVersion })
    if (!isCurrent()) return getConfig()
    // Do not merge/store catalog
    setAzureOpenaiModelsCatalog([])
    if (isCurrent()) setAzureOpenaiValidationOk(true)
  } catch (err) {
    if (!isCurrent()) return getConfig()
    setAzureOpenaiValidationOk(
      false,
      err instanceof Error ? err.message : String(err)
    )
  }
  return getConfig()
}

function getAzureOpenaiStatus(): AzureOpenaiStatus {
  const { ok, error } = getAzureOpenaiValidationState()
  const deployments = getAzureOpenaiDeployments()
  return {
    enabled: getAzureOpenaiEnabled(),
    validationOk: ok,
    validationError: error,
    catalogCount: 0,
    enabledCount: deployments.filter((d) => d.enabled).length,
    deploymentCount: deployments.length,
    enabledDeploymentCount: deployments.filter((d) => d.enabled).length
  }
}
```

Wire both `azureOpenai:validate` and any refresh handler that previously called `validateAzureOpenaiAndFetchCatalog` to `validateAzureOpenaiCredentials`. Remove `mergeAzureOpenaiCatalog` import.

- [ ] **Step 4: Run tests + typecheck**

Run:

```bash
node scripts/test-azure-deployments-only.mjs
npm run typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/shared/azure-openai-status.ts scripts/test-azure-deployments-only.mjs
git commit -m "$(cat <<'EOF'
feat: validate Azure OpenAI without storing model catalog

Keep the models endpoint as a credential probe and always report
catalogCount as zero.
EOF
)"
```

---

### Task 3: Provider uses deployment-name heuristics only

**Files:**
- Modify: `src/main/llm/azure-openai-provider.ts`
- Test: `scripts/test-azure-deployments-only.mjs` (provider tagging helper) or inline pure helpers in shared

**Interfaces:**
- Consumes: `getAzureOpenaiDeployments`, `isOpenAiVisionModel`
- Produces: `listModelsForChat` / `getModelInfo` with no `getAzureOpenaiModelsCatalog` usage; vision tag when `isOpenAiVisionModel(deployment.name)`

- [ ] **Step 1: Write failing test for tags**

Extract pure tagging into the provider file as exported functions for test, or add:

```ts
// in azure-openai-provider.ts — export for tests
export function azureDeploymentTags(deploymentName: string): string[] {
  const tags = ['azure-openai']
  if (isOpenAiVisionModel(deploymentName)) tags.push('vision')
  return tags
}
```

Test:

```js
test('azure deployment tags use name heuristics without catalog', async () => {
  const provider = await server.ssrLoadModule(
    new URL('../src/main/llm/azure-openai-provider.ts', import.meta.url).pathname
  )
  assert.deepEqual(provider.azureDeploymentTags('gpt-4o').sort(), ['azure-openai', 'vision'].sort())
  assert.deepEqual(provider.azureDeploymentTags('my-custom-deploy'), ['azure-openai'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-azure-deployments-only.mjs`  
Expected: FAIL — `azureDeploymentTags` not exported / still catalog-based.

- [ ] **Step 3: Simplify provider**

Replace catalog helpers with name-based tags:

```ts
export function azureDeploymentTags(deploymentName: string): string[] {
  const tags = ['azure-openai']
  if (isOpenAiVisionModel(deploymentName)) tags.push('vision')
  return tags
}

// listModelsForChat:
async listModelsForChat(): Promise<OllamaModel[]> {
  return getAzureOpenaiDeployments()
    .map((d) => ({ ...d, name: d.name.trim() }))
    .filter((d) => d.enabled && d.name)
    .map((d) => {
      const tags = azureDeploymentTags(d.name)
      return {
        name: d.name,
        size: 0,
        modifiedAt: '',
        tags,
        capabilities: tags
      }
    })
}

async getModelInfo(model) {
  const deployment = getAzureOpenaiDeployments().find(
    (entry) => entry.name.trim() === model.trim()
  )
  if (!deployment) return null
  const tags = azureDeploymentTags(deployment.name)
  return {
    capabilities: tags,
    contextLength: DEFAULT_CTX,
    catalogModelId: isOpenAiVisionModel(deployment.name) ? deployment.name : undefined
  }
}

detectVisionSupport(_model, info) {
  if (info?.capabilities?.includes('vision')) return 'yes'
  if (info?.catalogModelId && isOpenAiVisionModel(info.catalogModelId)) return 'yes'
  return 'unknown'
}
```

Remove imports of `getAzureOpenaiModelsCatalog` and catalog-matching helpers.

- [ ] **Step 4: Run tests + typecheck**

```bash
node scripts/test-azure-deployments-only.mjs
npm run typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/llm/azure-openai-provider.ts scripts/test-azure-deployments-only.mjs
git commit -m "$(cat <<'EOF'
feat: tag Azure deployments without catalog metadata

Infer vision from deployment name heuristics so the provider no longer
reads azureOpenaiModelsCatalog.
EOF
)"
```

---

### Task 4: Models UI — deployments only

**Files:**
- Modify: `src/renderer/src/components/ModelsPage.tsx`
- Modify: `src/renderer/src/App.tsx`
- Verify: `npm run typecheck`

**Interfaces:**
- Consumes: `azureOpenaiDeployments`, `azureOpenaiStatus`, deployment CRUD callbacks
- Produces: Azure tab with no `azureOpenaiCatalog` prop

- [ ] **Step 1: Remove catalog props and UI**

In `ModelsPage.tsx`:

- Drop `azureOpenaiCatalog` from props and destructuring.
- Remove `AzureOpenaiModelEntry` import if unused.
- Replace Azure tab body with deployments-only layout:

```tsx
) : tab === 'azure' ? (
  <div className="space-y-5">
    {!azureOpenaiStatus.validationOk && (
      <p className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
        Validate Azure OpenAI settings before using deployments.
        {azureOpenaiStatus.validationError
          ? ` (${azureOpenaiStatus.validationError})`
          : ''}
      </p>
    )}
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[#f0f4f8]">Deployments</h3>
          <p className="text-xs text-[#6b7a8c]">
            Add the deployment names configured in Azure. Only enabled deployments appear in chat.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRefreshAzure()}
          className="rounded-lg border border-[#2a3a4d] px-3 py-2 text-xs text-[#c5d0dc] hover:bg-[#1a2430]"
        >
          Re-validate
        </button>
      </div>
      {/* existing add form + deployment list */}
      {/* remove Catalog match / No catalog metadata match lines */}
      {/* keep Selected in chat, Enabled, Remove */}
    </div>
  </div>
)
```

In deployment rows, keep only:

```tsx
<p className="truncate text-sm text-[#e7ecf1]">{deployment.name}</p>
{deployment.name === selectedAzureOpenaiModel && (
  <p className="text-[11px] text-[#6eb5ff]">Selected in chat</p>
)}
```

- [ ] **Step 2: Unwire App.tsx catalog state**

Remove:

```ts
const [azureOpenaiCatalog, setAzureOpenaiCatalog] = useState<AzureOpenaiModelEntry[]>([])
```

Remove `setAzureOpenaiCatalog(...)` calls in `applyConfig` / `refreshAzureConfig`.  
Remove `azureOpenaiCatalog={azureOpenaiCatalog}` from `<ModelsPage />`.  
Drop unused `AzureOpenaiModelEntry` import if applicable.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 4: Manual smoke (if app available)**

1. Open Models → Azure OpenAI.
2. Confirm no Model catalog section.
3. Add/enable a deployment; confirm it appears in chat dropdown when Azure is the provider.
4. Settings → Validate Azure; confirm success/failure still works and catalog does not reappear.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ModelsPage.tsx src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
feat: show only Azure deployments on Models page

Remove catalog list, refresh-catalog copy, and match metadata from the
Azure OpenAI models tab.
EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| UI deployments only | Task 4 |
| Stop persisting catalog | Task 1 |
| Strip `matchedCatalogMetadata` | Task 1 + Task 4 |
| Validate via models GET, discard body | Task 2 |
| Provider name heuristics | Task 3 |
| OpenAI catalog unchanged | (no task — do not touch) |
| Existing deployments survive | Task 1 normalize on read |

## Self-review notes

- No TBD/placeholder steps.
- `mergeAzureOpenaiCatalog` deletion is owned by Task 1/2 together; Task 1 may leave a temporary clear helper if needed for compile.
- `catalogCount` remains on `AzureOpenaiStatus` for IPC shape compatibility but is always `0`.
