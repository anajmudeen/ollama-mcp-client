# Task 8 Report: End-to-end verification and regression checks

## Status

Verification completed on the `azure-openai-implementation` branch. No
verification code fix was required. The only working-tree change from this
task is this report.

## Commands and actual results

### Required static checks

Command: `npm run typecheck`

Result: exited `0`.

```text
> ollama-mcp-client@0.1.0 typecheck
> npm run typecheck:node && npm run typecheck:web

> ollama-mcp-client@0.1.0 typecheck:node
> tsc --noEmit -p tsconfig.node.json --composite false

> ollama-mcp-client@0.1.0 typecheck:web
> tsc --noEmit -p tsconfig.web.json --composite false
```

Command: `npm run check:openai-vision`

Result: exited `0`.

```text
OpenAI vision/image classifier checks passed
```

Command: `git diff --check`

Result: exited `0`; no output.

### Azure HTTP/client verification

Command: `node scripts/test-azure-openai-client.mjs`

Result: exited `0`; 5 tests passed, 0 failed, 0 skipped.

```text
1..5
# tests 5
# pass 5
# fail 0
# cancelled 0
# skipped 0
```

The focused tests verified endpoint trailing-slash normalization, encoded
model/deployment and API-version URL components, model catalog sorting and
capabilities, `api-key` authentication, safe validation errors, streaming
content/reasoning/tool-call/usage parsing, absence of `Authorization`, and
non-streaming abort-signal propagation. The test process also emitted Vite
dependency-scan messages saying “The server is being restarted or closed.
Request is outdated” while its temporary SSR server shut down; these were
non-fatal and the Node test runner exited successfully.

### Existing OpenAI vision/image checks

Command: `node scripts/test-openai-image-edit.mjs`

Result: exited `0`; 11 tests passed, 0 failed, 0 skipped.

Command: `node scripts/test-agent-image-attachments.mjs`

Result: exited `0`; 11 tests passed, 0 failed, 0 skipped.

### Production build

Command: `npm run build`

Result: exited `0`. TypeScript node/web checks passed and Electron Vite
completed main, preload, and renderer production bundles.

### Security and compatibility searches

Command:
`rg -n -i --glob '!node_modules/**' --glob '!dist/**' --glob '!out/**' '(api[-_ ]?key|azure.*key|AZURE_OPENAI)' src scripts docs`
with expected UI/config identifier noise filtered for the review.

Result: Azure key access is in main-process config/client/IPC code. The
renderer-facing `getConfig()` value is explicitly `azureOpenaiApiKey: null`;
the renderer only maintains a local blank draft and receives status/config
without the raw key. No raw Azure key was found in logging output paths.

Command:
`rg -n --glob '!node_modules/**' --glob '!dist/**' --glob '!out/**' 'Authorization|api.openai.com/v1' src/main src/preload src/renderer src/shared scripts`

Result: existing OpenAI requests continue to use
`https://api.openai.com/v1` and `Authorization: Bearer ...` in
`src/main/openai-client.ts` and `src/main/openai-image.ts`. Azure’s focused
test asserts `Authorization === undefined` and uses `api-key`.

### Credential-free manual/static acceptance

Command:

```sh
set -e
checks=(
  'Title generation|generateTitle|chatOnce'
  'Compaction|compact|summar'
  'Telegram|telegram'
  'Schedules|schedule'
  'MCP tools|toolCalls|tools'
  'Vision input|images|vision'
  'Provider persistence|selectedModelByProvider'
  'Ollama fallback|resolveEffectiveLlmProvider'
)
for item in "${checks[@]}"; do
  label=${item%%|*}; pattern=${item#*|}
  if rg -q "$pattern" src/main src/renderer; then
    printf 'PASS: %s (%s)\n' "$label" "$pattern"
  else
    printf 'MISSING: %s (%s)\n' "$label" "$pattern"
  fi
done
```

Result: all eight checks reported `PASS`. The relevant provider adapters,
agent/runtime paths, persistence paths, and fallback paths are present and
typechecked.

## Skipped live checks and concerns

Live Azure validation/model catalog retrieval, streaming chat against an Azure
deployment, MCP tool use through a live Azure model, vision input against a
live Azure model, and UI acceptance of manual deployment management could not
be executed without Azure credentials, a reachable endpoint/deployment, and a
running Electron session. Telegram and schedules likewise were not exercised
against external services. No credentials were available or used.

The only observed concern is the non-fatal Vite temporary-server shutdown
diagnostic from the mocked Azure client test described above. It did not
change the test exit status or assertions.

## Commit

No code fix was needed. This report is the verification/documentation change
committed separately to preserve the repository’s existing per-task report
convention.

## Final-review fixes — 2026-09-27

Implemented the remaining final-review findings:

- Reused `openAiModelUsesReasoningEffort` for Azure chat bodies. Azure now
  sends `reasoning_effort: "none"` only when tools are present and the
  deployment identifier matches a supported reasoning-model convention.
- Extended agent stream-usage aggregation to treat `azure-openai` like
  `openai`, preserving cached prompt and reasoning token counts across every
  model call in a tool loop while leaving Ollama counters unchanged.
- Added an Azure validation generation token in the main process. Starting a
  newer validation or changing Azure credentials, endpoint, or API version
  invalidates older requests; stale responses no longer update the catalog,
  deployment metadata, or validation state.
- Restricted the IPC deployment-add contract to a trimmed name. Name-only
  additions default to disabled, and repeated adds no longer reset an
  existing deployment's explicit enabled toggle.
- Removed the trailing whitespace reported by the Task 5 report.

Focused verification covered Azure request-body reasoning assertions,
stream usage parsing, TypeScript compilation, the production build,
OpenAI vision checks, image-related tests, and repository whitespace checks.
Concurrent Azure validation was reviewed through the generation-token guard;
no live Azure endpoint was used because credentials and a reachable service
were unavailable.

## Final-review fixes — selected-model migration and Azure disable guard

Implemented:

- Added persisted-file detection for `selectedModelByProvider`, avoiding
  electron-store defaults during legacy migration. A legacy `selectedModel`
  now migrates to the Ollama slot, while an actually persisted provider map
  preserves its OpenAI and Azure slots.
- Added `migrateSelectedModelByProvider` regression coverage for legacy and
  provider-map cases in `scripts/test-config-store-migrations.mjs`.
- Clearing an Azure deployment's enabled toggle now clears that deployment
  from the Azure provider selection. Agent turn startup also validates Azure
  deployment availability and refuses stale/disabled selections without
  changing OpenAI or Ollama selection behavior.

## Exact verification results

- `npm run typecheck` — exit 0.
- `npm run build` — exit 0; main, preload, and renderer bundles built.
- `node scripts/test-config-store-migrations.mjs` — exit 0; 1 test passed.
  Vite emitted a non-fatal `WebSocket server error: Port 24678 is already in
  use` and temporary-server shutdown diagnostics; the TAP test passed.
- `node scripts/test-azure-openai-client.mjs` — exit 0.
- `node scripts/test-image-gen-tool.mjs` — exit 0.
- `node scripts/test-agent-image-attachments.mjs` — exit 0.
- `node scripts/test-openai-image-edit.mjs` — exit 0.
- `npm run check:openai-vision` — exit 0; OpenAI vision/image classifier
  checks passed.
- `git diff --check 4bb3cda HEAD` — exit 0.
- `git diff --check` — exit 0.
- IDE linter diagnostics for changed TypeScript and regression-test files —
  no linter errors.

Live Azure service validation was not run because no credentials or reachable
deployment were available. These fixes were committed in the final review
fix commit for this branch.

## Final-review fix — renderer Ollama fallback

Updated renderer provider/model synchronization so model catalogs and selected
model state follow the effective provider returned by main-process fallback
resolution. When Azure is configured but has no enabled deployments, the
renderer now loads and displays the selected Ollama model, keeps send
readiness based on Ollama availability, and sends that Ollama model payload.
Azure deployment empty-state guidance remains visible only when Azure is the
effective provider. OpenAI and Ollama provider-specific selection semantics
remain unchanged.

## Exact verification results

- `npm run typecheck` — exit 0.
- `npm run build` — exit 0; main, preload, and renderer bundles built.
- `node scripts/test-config-store-migrations.mjs` — exit 0.
- `node scripts/test-azure-openai-client.mjs` — exit 0.
- `node scripts/test-image-gen-tool.mjs` — exit 0.
- `node scripts/test-agent-image-attachments.mjs` — exit 0.
- `node scripts/test-openai-image-edit.mjs` — exit 0.
- `npm run check:openai-vision` — exit 0; OpenAI vision/image classifier
  checks passed.
- `git diff --check 4bb3cda HEAD` — exit 0.
- `git diff --check` — exit 0.
- IDE linter diagnostics for changed renderer files — no linter errors.

No standalone renderer test harness exists in the project; the fallback
behavior was covered by the typecheck/build path and the existing focused
provider tests. Live Azure service validation was not run without credentials.

## Final-review fix — fallback selection persistence

Updated renderer model selection persistence to use `effectiveProvider`
instead of the configured provider. When Azure or OpenAI falls back to
Ollama, selecting the visible Ollama model now writes only the Ollama slot;
the configured cloud provider and its saved selection remain unchanged. When
the cloud provider is effective, its existing slot and UI state continue to
be updated, and the selected model remains synchronized with the request
payload.

## Exact verification results

- `npm run typecheck` — exit 0.
- `npm run build` — exit 0; main, preload, and renderer bundles built.
- `node scripts/test-config-store-migrations.mjs` — exit 0.
- `node scripts/test-azure-openai-client.mjs` — exit 0.
- `node scripts/test-image-gen-tool.mjs` — exit 0.
- `node scripts/test-agent-image-attachments.mjs` — exit 0.
- `node scripts/test-openai-image-edit.mjs` — exit 0.
- `npm run check:openai-vision` — exit 0; OpenAI vision/image classifier
  checks passed.
- `git diff --check 4bb3cda HEAD` — exit 0.
- `git diff --check` — exit 0.
- IDE linter diagnostics for `src/renderer/src/App.tsx` — no linter errors.

No standalone renderer regression harness exists; the focused persistence
change is covered by the typecheck/build verification and existing provider
selection paths. Live cloud-provider validation was not run without
credentials.
