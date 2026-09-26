# Azure OpenAI Provider Implementation Plan

> **Superseded image-backend guidance:** The image-specific global constraints
> and agent-task claims in this historical Azure plan are superseded by the
> independent image-backend design. See
> [`../specs/2026-09-27-azure-openai-provider-design.md`](../specs/2026-09-27-azure-openai-provider-design.md)
> and
> [`2026-09-27-independent-image-backend.md`](2026-09-27-independent-image-backend.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Azure OpenAI as a separate, selectable LLM provider with API-key validation, model catalog refresh, manually managed deployments, OpenAI-compatible streaming/tool behavior, and Ollama fallback.

**Architecture:** Extend the existing provider/config abstractions with an `azure-openai` provider. Keep Azure HTTP differences in a dedicated client/provider adapter while sharing the existing OpenAI message conversion and SSE parsing logic. Route agent, title, compaction, Telegram, schedules, and UI model selection through provider-aware configuration.

**Tech Stack:** Electron, electron-store, TypeScript, React 19, Electron IPC/preload, native `fetch`, Azure OpenAI REST API.

## Global Constraints

- Existing Ollama and OpenAI behavior must remain compatible.
- Azure uses `api-key` authentication, never Bearer authentication.
- Azure validation uses `GET {endpoint}/openai/models?api-version={version}`.
- Azure chat uses `/openai/deployments/{deployment}/chat/completions?api-version={version}`.
- Default Azure API version is `2024-10-21`.
- Deployment names are entered manually and are disabled by default.
- Runtime fallback to Ollama preserves the configured provider.
- API keys remain in the main process and are never logged or exposed through renderer state.
> **Superseded constraint:** The historical Ollama-only image-generation
> constraint below is superseded by the independent image-backend design linked
> above.
- Azure image generation is out of scope; Ollama image generation remains Ollama-only.
- Run `npm run typecheck` after each task that changes TypeScript.
- Use focused tests/scripts where no test runner exists, and run the complete manual checklist before handoff.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/shared/types.ts` | Azure provider, catalog, deployment, status, and config types |
| `src/main/config-store.ts` | Azure defaults, persistence, migration, catalog/deployment helpers |
| `src/main/azure-openai-client.ts` | Azure URL construction, validation/catalog HTTP, chat HTTP/SSE |
| `src/main/openai-client.ts` | Extract reusable OpenAI-compatible conversion/SSE helpers only if needed |
| `src/main/llm/types.ts` | Provider interface additions for Azure model metadata |
| `src/main/llm/azure-openai-provider.ts` | Azure provider adapter |
| `src/main/llm/effective-provider.ts` | Three-provider availability/fallback resolution |
| `src/main/llm/index.ts` | Provider registry |
| `src/main/ipc.ts` | Azure settings, validation, deployment, and model IPC |
| `src/preload/index.ts` | Renderer-safe Azure IPC API |
| `src/preload/index.d.ts` | Preload type declarations, if separate declarations require updates |
| `src/main/agent.ts` | Effective provider/model routing |
| `src/main/session-title.ts` | Provider-aware title generation |
| `src/main/context-compact.ts` | Provider-aware compaction |
| `src/main/schedule-executor.ts` | Provider-aware scheduled execution if it bypasses the agent |
| `src/renderer/src/components/Settings.tsx` | Azure settings controls |
| `src/renderer/src/components/ModelsPage.tsx` | Azure catalog/deployment management |
| `src/renderer/src/components/Chat.tsx` | Azure model dropdown and fallback messaging |
| `src/renderer/src/App.tsx` | Configuration state and IPC wiring |
| `scripts/test-azure-openai-client.mjs` | Focused request/catalog behavior checks if a standalone harness is needed |

## Task 1: Shared Azure types and persistent configuration

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/config-store.ts`

**Interfaces:**
- Produces `LlmProvider = 'ollama' | 'openai' | 'azure-openai'`.
- Produces `AzureOpenaiModelEntry`, `AzureOpenaiDeploymentEntry`, and `AzureOpenaiStatus`.
- Extends `SelectedModelByProvider` with `'azure-openai': string | null`.
- Produces getters/setters for Azure settings, catalog, deployment records, and selected model.

- [ ] **Step 1: Add shared types**

Define catalog entries with `id`, optional capability metadata, and optional `created`. Define deployment entries with a unique `name`, `enabled`, and optional matched catalog metadata. Add Azure fields to `AppConfig` and add Azure counts/status fields matching the existing OpenAI status pattern.

- [ ] **Step 2: Extend store defaults**

Set Azure defaults to disabled, null key/endpoint, API version `2024-10-21`, invalid validation state, empty catalog/deployments, and null selected model. Expand `getLlmProvider()` and `setLlmProvider()` to preserve unknown-value safety by accepting only the three provider IDs.

- [ ] **Step 3: Implement Azure store helpers**

Add `getAzureOpenaiApiKey`, `setAzureOpenaiApiKey`, `getAzureOpenaiEndpoint`, `setAzureOpenaiEndpoint`, `getAzureOpenaiApiVersion`, `setAzureOpenaiApiVersion`, validation state helpers, catalog helpers, deployment add/update/remove helpers, and enabled-state helpers. Normalize endpoint trailing slashes and trim deployment names. Reject duplicate names or update the existing record deterministically.

- [ ] **Step 4: Preserve manual deployments across catalog refresh**

Implement catalog merge so catalog entries and manual deployments remain separate. Update matched metadata on deployments where the deployment name equals a catalog ID, but never delete a manually entered deployment because a catalog refresh omitted its model.

- [ ] **Step 5: Migrate selected-model storage**

Ensure missing `selectedModelByProvider` migrates legacy Ollama selection and initializes both cloud provider slots to null. Existing OpenAI selection must remain unchanged. Update `getConfig()` to return Azure fields and provider-specific selection.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run typecheck
```

Expected: PASS. Then commit:

```bash
git add src/shared/types.ts src/main/config-store.ts
git commit -m "feat: add Azure OpenAI configuration schema"
```

## Task 2: Azure REST client and focused request tests

**Files:**
- Create: `src/main/azure-openai-client.ts`
- Modify: `src/main/openai-client.ts` if shared conversion/SSE functions are extracted
- Create: `scripts/test-azure-openai-client.mjs` if the existing project test-script style is used

**Interfaces:**
- Produces `normalizeAzureEndpoint(endpoint: string): string`.
- Produces `buildAzureModelsUrl(endpoint: string, apiVersion: string): string`.
- Produces `buildAzureChatUrl(endpoint: string, deployment: string, apiVersion: string): string`.
- Produces `fetchAzureModels(options): Promise<AzureOpenaiModelEntry[]>`.
- Produces `validateAzureOpenai(options): Promise<{ ok: boolean; error?: string }>` .
- Produces Azure `chatOnce` and `chatStream` results matching `OpenAiStreamResult`.

- [ ] **Step 1: Write focused failing tests**

Test endpoint trailing-slash normalization, encoded API version/deployment values, `/openai/models` URL construction, deployment chat URL construction, `api-key` header selection, and absence of `Authorization`.

- [ ] **Step 2: Run the focused tests**

Run:

```bash
node scripts/test-azure-openai-client.mjs
```

Expected: FAIL until the URL and request helpers exist.

- [ ] **Step 3: Implement model validation/catalog requests**

Use the configured endpoint and API version to call `/openai/models`. Parse `data` entries into the shared Azure catalog shape, retaining chat-completion capability metadata and sorting by ID. Convert Azure error bodies to service messages without including credentials.

- [ ] **Step 4: Implement Azure chat requests**

Build the deployment URL, send `api-key`, JSON content type, converted messages/tools, and `stream` settings. Reuse or extract the existing OpenAI-compatible message conversion, tool conversion, streamed content/tool-call accumulation, reasoning deltas, and usage parsing. Do not send `model` as the deployment selector in the URL-based Azure request.

- [ ] **Step 5: Implement non-streaming calls**

Implement `chatOnce` for title generation and context compaction using the same message conversion and deployment URL. Respect `AbortSignal`.

- [ ] **Step 6: Verify and commit**

Run the focused tests and:

```bash
npm run typecheck:node
```

Expected: PASS. Commit:

```bash
git add src/main/azure-openai-client.ts src/main/openai-client.ts scripts/test-azure-openai-client.mjs
git commit -m "feat: add Azure OpenAI REST client"
```

## Task 3: Azure provider adapter and provider resolution

**Files:**
- Modify: `src/main/llm/types.ts`
- Create: `src/main/llm/azure-openai-provider.ts`
- Modify: `src/main/llm/effective-provider.ts`
- Modify: `src/main/llm/index.ts`

**Interfaces:**
- Produces `azureOpenaiLlmProvider: LlmProvider`.
- Extends provider model info with Azure catalog capabilities where needed.
- `getLlmProvider('azure-openai')` returns the Azure adapter.
- `resolveEffectiveLlmProvider()` resolves Ollama, OpenAI, or Azure with fallback reasons.

- [ ] **Step 1: Add provider adapter**

Delegate `chatStream` and `chatOnce` to the Azure client using the selected deployment as the request model. List only enabled manual deployments, decorate capabilities from the catalog, and report Azure chat models as non-image-generation models. Use conservative vision detection from matched catalog capabilities and known Azure model IDs.

- [ ] **Step 2: Extend effective-provider checks**

For Azure, require enabled state, non-empty key, normalized endpoint, non-empty API version, successful validation, and at least one enabled deployment. Return Ollama with a clear reason when any prerequisite fails.

- [ ] **Step 3: Register the provider**

Update the provider registry and preserve existing OpenAI/Ollama paths.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run typecheck:node
```

Commit:

```bash
git add src/main/llm
git commit -m "feat: register Azure OpenAI LLM provider"
```

## Task 4: IPC and preload contracts

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**Interfaces:**
- Adds Azure settings IPC.
- Adds Azure validation/refresh IPC.
- Adds deployment CRUD and enable-state IPC.
- Adds `azureOpenai.listChatModels()`.
- Keeps raw API keys out of renderer responses.

- [ ] **Step 1: Add settings handlers**

Register handlers for provider selection, enabled state, key, endpoint, and API version. Setting an empty key or endpoint clears validation state with an actionable error.

- [ ] **Step 2: Add validation and refresh handlers**

Validate using the stored main-process key/settings, merge the catalog on success, preserve prior data on failure, and return sanitized config/status.

- [ ] **Step 3: Add deployment handlers**

Register add/update/remove and enabled-state handlers. Clear the Azure selected model when its deployment is removed. Return deployment state after each mutation.

- [ ] **Step 4: Add preload APIs and types**

Expose only sanitized config/status, Azure catalog/deployment methods, and model listing. Do not add a renderer API that returns the raw Azure key.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm run typecheck
```

Commit:

```bash
git add src/main/ipc.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: expose Azure OpenAI configuration IPC"
```

## Task 5: Route all main-process callers through Azure-aware providers

**Files:**
- Modify: `src/main/agent.ts`
- Modify: `src/main/session-title.ts`
- Modify: `src/main/context-compact.ts`
- Modify: `src/main/schedule-executor.ts` if it directly imports Ollama
- Modify: `src/shared/types.ts` only if fallback/status payload types need the third provider

**Interfaces:**
- Agent turns use `resolveEffectiveLlmProvider()` and the effective provider's selected model.
- Titles and compaction use the same effective provider.
- Telegram and scheduled runs continue through the same routing path.

- [ ] **Step 1: Replace direct provider selection in agent**

Resolve configured/effective provider at turn start, select the model from the effective provider slot, emit the existing fallback event once when needed, and use provider methods for streaming, info, vision, context, and tool calls.

> **Superseded task claim:** The historical image-tool routing claim in this
> task is superseded by the independent image-backend design linked above.

- [ ] **Step 2: Preserve image-tool boundaries**

Run image generation only when the effective provider is Ollama and the selected Ollama model supports it. Azure and OpenAI chat paths must not invoke Ollama image generation accidentally.

- [ ] **Step 3: Update title and compaction calls**

Use provider `listModelsForChat` and `chatOnce`; do not assume model IDs are globally available or that an Azure deployment has an OpenAI model-shaped ID.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run typecheck:node
```

Commit:

```bash
git add src/main/agent.ts src/main/session-title.ts src/main/context-compact.ts src/main/schedule-executor.ts src/shared/types.ts
git commit -m "feat: route agent flows through Azure provider"
```

## Task 6: Settings and Models UI

**Files:**
- Modify: `src/renderer/src/components/Settings.tsx`
- Modify: `src/renderer/src/components/ModelsPage.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Settings consumes sanitized Azure config/status and exposes Azure configuration actions.
- Models page consumes Azure catalog/deployments and exposes manual deployment management.

- [ ] **Step 1: Add Azure state and handlers in App**

Load Azure fields from `config:get`, refresh sanitized config after each Azure mutation, and preserve existing OpenAI/Ollama state handling.

- [ ] **Step 2: Add Azure settings controls**

Add provider option, enable toggle, masked key field, endpoint field, API-version field defaulted to `2024-10-21`, validation button, status/error, and Models-page link. Disable controls appropriately when Azure is disabled.

- [ ] **Step 3: Add Azure Models section**

Display catalog model IDs/capabilities separately from deployment entries. Add a deployment-name form, duplicate validation, remove action, enabled toggle, matched metadata, refresh action, and empty-state guidance.

- [ ] **Step 4: Verify UI types**

Run:

```bash
npm run typecheck:web
```

Then run `npm run dev` and verify the controls render without the raw API key appearing in renderer state or logs.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Settings.tsx src/renderer/src/components/ModelsPage.tsx src/renderer/src/App.tsx
git commit -m "feat: add Azure OpenAI settings and deployment UI"
```

## Task 7: Chat model selection and fallback UI

**Files:**
- Modify: `src/renderer/src/components/Chat.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/shared/types.ts` only if provider fallback copy/types require adjustment

**Interfaces:**
- Chat model list depends on configured provider.
- Azure list contains enabled deployment names only.
- Fallback status is visible without mutating the selected provider.

- [ ] **Step 1: Load provider-specific model lists**

Use Ollama installed models, OpenAI enabled catalog models, or Azure enabled deployment entries according to the configured provider. Persist selection to the matching provider slot.

- [ ] **Step 2: Add Azure empty states**

When Azure has no enabled deployments, explain that a deployment name must be added and enabled on the Models page. Do not offer catalog model IDs as chat selections.

- [ ] **Step 3: Add fallback warning**

Query effective provider status and display the existing fallback event/banner when Azure is configured but unavailable. Keep the configured provider selector unchanged.

- [ ] **Step 4: Adjust send guards**

Do not block a valid Azure request because Ollama is offline. If Azure falls back to Ollama, apply the existing Ollama readiness guard and explain the reason.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm run typecheck
```

Manually switch providers and confirm independent selected models. Commit:

```bash
git add src/renderer/src/components/Chat.tsx src/renderer/src/App.tsx src/shared/types.ts
git commit -m "feat: add Azure model selection and fallback UI"
```

## Task 8: End-to-end verification and regression checks

**Files:**
- Modify focused test scripts or docs only if verification exposes a defect.

- [ ] **Step 1: Run all static checks**

```bash
npm run typecheck
npm run check:openai-vision
git diff --check
```

Expected: all commands pass.

- [ ] **Step 2: Verify Azure HTTP behavior**

Use the focused client test or a mocked fetch harness to confirm model-list and chat URLs, query encoding, `api-key` headers, streaming parsing, tool-call parsing, and no Bearer header.

- [ ] **Step 3: Execute manual acceptance**

Verify successful validation, catalog display, manual deployment add/enable, streaming chat, MCP tool use, vision input, invalid-configuration Ollama fallback, provider-specific model persistence, title generation, compaction, Telegram, and schedules.

- [ ] **Step 4: Review security and compatibility**

Search logs and renderer-facing config paths for raw Azure API key usage. Confirm existing OpenAI requests still use `Authorization: Bearer` and `https://api.openai.com/v1`.

- [ ] **Step 5: Commit verification fixes**

If verification requires changes, run the relevant focused check again and commit:

```bash
git add .
git commit -m "test: verify Azure OpenAI provider integration"
```

## Plan self-review

- Provider identity and independent selection: Tasks 1, 3, 7.
- API key/endpoint/version settings: Tasks 1, 4, 6.
- Azure models endpoint and API-key authentication: Task 2.
- Manual deployment management: Tasks 1, 4, 6, 7.
- OpenAI-compatible stream/tools/vision/usage: Tasks 2, 3, 5, 8.
- Runtime fallback: Tasks 3, 5, 7.
- Main-only credentials: Tasks 2, 4, 6, 8.
- Existing OpenAI regression protection: Tasks 2, 3, 8.
- No automatic deployment discovery or Azure image generation: Tasks 1, 5, 6.

No placeholders or unassigned specification requirements remain.
