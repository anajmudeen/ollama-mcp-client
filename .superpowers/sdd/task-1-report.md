# Task 1 Implementation Report

## Status

DONE

## Commit

`fa3944a` — `feat: add independent image backend config`

## Scope

- Added `ImageBackendProvider` and `ImageBackendSelection` shared types.
- Added nullable `imageBackend` config default and sanitized persistence helpers.
- Added structured-selection migration with OpenAI-first matching, Ollama matching against supplied verified installed models, unresolved-value handling, and provider/model collision preservation.
- Kept `defaultImageModel` as a deprecated compatibility field for the current branch’s existing consumers.
- Added focused migration tests in `scripts/test-image-backend-routing.mjs`.

## Verification

- `node scripts/test-image-backend-routing.mjs` — PASS, 5 tests.
- `npm run typecheck` — PASS, node and web checks.
- `git diff --check` — PASS.
- IDE lints for changed files — PASS; no errors.

## Self-review

The persisted structured value is normalized before being returned, explicit `null` clears it, invalid non-null selections are rejected, and migration checks enabled OpenAI image models before verified Ollama image models. Azure is not an accepted image backend provider, and chat-provider model slots were not modified.

## Concerns

The synchronous migration intentionally uses a conservative local name heuristic for legacy Ollama values; names that cannot be identified locally remain `null` until later explicit image-backend selection/discovery.

## Fix

### Changes

- Production `getImageBackend()` now identifies legacy Ollama image models using the existing local image-model name heuristic, while retaining OpenAI-first matching and unresolved `null`.
- `getConfig()` now returns `openaiApiKey: null`; main-process `getOpenaiApiKey()` remains unchanged for validation and HTTP requests.
- Renderer config application now treats the OpenAI key field as write-only.
- Focused tests cover the actual production migration path and renderer credential sanitization.

### Verification

- `node scripts/test-image-backend-routing.mjs` — PASS, 7 tests.
- `npm run typecheck` — PASS.
- `git diff --check` — PASS.
# Task 1 Report

## Result

Implemented and committed the OpenAI Images Edits helper.

Commit: `0474d97a060eeb662e4e6ebfce3cabd25f6673f3`

## Files changed

- `src/main/openai-image.ts`
  - Added `editOpenAiImageBase64(model, prompt, images, signal?)`.
  - Uses multipart `FormData` with `model`, `prompt`, `n=1`, and one PNG `image` Blob per raw base64 payload.
  - Preserves existing API-key validation, OpenAI error formatting, usage parsing, base64 normalization, and abort-signal forwarding.
  - Rejects empty or malformed source payloads and empty image arrays.
- `scripts/test-openai-image-edit.mjs`
  - Added a focused Node test harness using Vite's SSR loader because the repository has no configured test runner, Vitest, Jest, or tsx setup.
  - Covers one-image multipart requests, multiple ordered image parts, usage parsing, API error formatting, and abort-signal forwarding.

## Verification

- `node scripts/test-openai-image-edit.mjs`
  - `3` tests, `3` passed, `0` failed.
  - Vite emitted dependency-scan diagnostics while loading the Electron renderer graph, but the focused tests completed successfully.
- `npm run typecheck`
  - Node and web TypeScript checks passed.
- `npm run build`
  - Production Electron/Vite build passed.
- `git diff --check`
  - Passed.
- IDE lint diagnostics for both changed files
  - No errors.

The initial red-phase attempt exposed that the normal production build bundles the main process into `out/main/index.js` rather than emitting `out/main/openai-image.js`; the harness was then adapted to load the TypeScript source through Vite SSR.

## Concerns

- There is no repository test script, so the focused harness is run directly with `node scripts/test-openai-image-edit.mjs`.
- The harness produces noisy Vite dependency-scan diagnostics from the existing renderer dependency graph, though its test result is clean.
> **Superseded historical report:** The legacy `defaultImageModel` runtime and UI
> claims in the report below were superseded by the independent image-backend
> design. See
> [`docs/superpowers/specs/2026-09-27-azure-openai-provider-design.md`](../../docs/superpowers/specs/2026-09-27-azure-openai-provider-design.md)
> and
> [`docs/superpowers/plans/2026-09-27-independent-image-backend.md`](../../docs/superpowers/plans/2026-09-27-independent-image-backend.md).

# Task 1 Report: Config + pure resolve helpers

## Status

**DONE**

## Summary

Implemented `defaultImageModel` on `AppConfig` with electron-store persistence and created `src/main/image-gen-tool.ts` with pure resolve helpers and the `generate_image` tool definition/runner. No agent, IPC, or Settings wiring (per task scope).

## Changes

### `src/shared/types.ts`

- Added `defaultImageModel: string | null` to `AppConfig` with JSDoc: preferred image model for `generate_image`; `null` = Auto (first installed).

### `src/main/config-store.ts`

- Added `defaultImageModel: null` to `DEFAULT_CONFIG`.
- Included `defaultImageModel` in `getConfig()` return object.
- Added `getDefaultImageModel()` and `setDefaultImageModel(model)` (trimmed non-empty string or `null`).

### `src/main/image-gen-tool.ts` (new)

Exports per brief:

| Export | Purpose |
|--------|---------|
| `GENERATE_IMAGE_NAME` | Tool name constant (`generate_image`) |
| `resolveDefaultImageModel` | Pure: configured if in list, else first, else null |
| `listInstalledImageModelNames` | Filters `listModels()` via `modelIsImageGen` |
| `shouldOfferGenerateImageTool` | False if Ollama lacks image gen, selected model is image gen, or no image models |
| `generateImageToolDefinition` | Ollama function tool schema with `prompt` |
| `runGenerateImageTool` | Validates prompt, resolves model, calls `generateImageBase64` |
| `GenerateImageToolResult` | Discriminated union for success/failure |

## Verification

### `resolveDefaultImageModel` sanity check

All four cases from the brief pass:

- `resolveDefaultImageModel(null, ['a', 'b'])` → `'a'`
- `resolveDefaultImageModel('b', ['a', 'b'])` → `'b'`
- `resolveDefaultImageModel('gone', ['a'])` → `'a'`
- `resolveDefaultImageModel(null, [])` → `null`

### Typecheck

```bash
npm run typecheck
```

**PASS** (node + web, exit 0)

### Lint

No linter errors on modified/created files.

## Commit

- `1617047` — Add defaultImageModel config and generate_image tool helpers.

## Self-review

- Matches task brief verbatim for types, config-store API, and `image-gen-tool.ts` implementation.
- Follows existing `config-store.ts` patterns (`get*` / `set*` with trim/null normalization).
- Reuses existing `ollama.ts` and `ollama-image.ts` exports; no duplicate logic.
- Scope limited to Task 1; no premature agent/IPC/Settings changes.
- `StoreSchema` extends `AppConfig`, so `defaultImageModel` is included in store defaults via spread of `DEFAULT_CONFIG`.

## Concerns

None.

## Next tasks (out of scope)

- Wire `shouldOfferGenerateImageTool` / `generateImageToolDefinition` / `runGenerateImageTool` into the agent loop.
- IPC + Settings UI for `defaultImageModel` selection.

## Fix

### Changed files

- `src/main/config-store.ts` — `getConfig()` now returns `null` for `azureOpenaiApiKey`; raw Azure keys remain available through main-process helper access only.
- `.superpowers/sdd/task-1-report.md` — appended this fix report.

### Verification

- `npm run typecheck` — PASS (node and web checks, exit 0).
