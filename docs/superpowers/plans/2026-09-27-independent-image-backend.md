# Independent Image Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow any chat LLM provider, including Azure OpenAI, to use one independently selected OpenAI or Ollama image backend for image generation tools.

**Architecture:** Introduce a persisted `{ provider, model }` image-backend selection separate from chat-provider/model selection. Centralize available-image discovery and route generation/editing through the selected backend, while the agent offers image tools based on image-backend availability rather than the chat provider. Keep Ollama editing unsupported and preserve existing OpenAI image APIs.

**Tech Stack:** Electron, electron-store, TypeScript, React 19, Electron IPC/preload, existing Ollama image API, existing OpenAI Images API.

## Global Constraints

- The image backend is independent of the configured/effective chat provider.
- Exactly one image backend is selected at a time; there is no automatic fallback.
- The persisted value is `{ provider: 'openai' | 'ollama'; model: string } | null`.
- Existing `defaultImageModel: string | null` values migrate when the model can be identified.
- Azure chat can receive image tools, but Azure-native image generation is out of scope.
- Ollama image generation uses the existing Ollama image API.
- OpenAI image generation and editing use the existing OpenAI image APIs.
- Ollama image editing returns a clear unsupported-operation result.
- No image backend selected or available means image tools are not offered.
- Image requests use only credentials for the selected image provider.
- Run `npm run typecheck` after each TypeScript task and run focused tests before claiming completion.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/shared/types.ts` | Persisted image-backend type and config field |
| `src/main/config-store.ts` | Defaults, migration, getters/setters, availability-safe selection |
| `src/main/image-gen-tool.ts` | Image backend discovery, routing, generation/editing behavior |
| `src/main/agent.ts` | Offer image tools based on selected backend, independent of chat provider |
| `src/main/agent-tool-boundary.ts` | Keep image tool definitions available for all chat providers |
| `src/main/ipc.ts` | Image-backend config IPC |
| `src/preload/index.ts` | Renderer-safe image-backend API |
| `src/renderer/src/components/Settings.tsx` | Combined provider-grouped image selector |
| `src/renderer/src/App.tsx` | Image backend state, discovery, and selection wiring |
| `src/renderer/src/components/Chat.tsx` | Provider-aware image-model display and attachment behavior |
| `scripts/test-image-backend-routing.mjs` | Focused mocked routing and migration checks |

## Task 1: Shared image-backend configuration and migration

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/config-store.ts`

**Interfaces:**
- Produces `ImageBackendProvider = 'openai' | 'ollama'`.
- Produces `ImageBackendSelection = { provider: ImageBackendProvider; model: string }`.
- Extends `AppConfig` with `imageBackend: ImageBackendSelection | null`.
- Produces `getImageBackend()` and `setImageBackend(selection)`.

- [ ] **Step 1: Add shared types**

Define the provider union and selection interface. Replace the new feature’s use of `defaultImageModel` with `imageBackend`, while retaining the legacy field in the store schema only for migration compatibility.

- [ ] **Step 2: Add defaults and migration**

Default `imageBackend` to null. On read, if a valid persisted `imageBackend` exists, normalize and return it. Otherwise inspect legacy `defaultImageModel`: match enabled OpenAI image models first, then installed Ollama image models; if neither can be verified, return null. Do not migrate Azure as an image backend.

- [ ] **Step 3: Add persistence helpers**

Trim model names, reject empty selections, preserve provider/model together, and clear the selection when explicitly set to null. `getConfig()` must return the sanitized selection but never expose API keys.

- [ ] **Step 4: Add focused migration tests**

Extend or create a direct Node/Vite harness that checks OpenAI legacy identification, Ollama legacy identification, unresolved legacy values, valid structured selection, and provider/model collision preservation.

- [ ] **Step 5: Verify and commit**

Run:

```bash
node scripts/test-image-backend-routing.mjs
npm run typecheck
```

Commit:

```bash
git add src/shared/types.ts src/main/config-store.ts scripts/test-image-backend-routing.mjs
git commit -m "feat: add independent image backend config"
```

## Task 2: Image backend discovery and routing

**Files:**
- Modify: `src/main/image-gen-tool.ts`
- Modify: `src/main/openai-image.ts` only if a narrowly scoped reusable helper is required
- Modify: `scripts/test-image-backend-routing.mjs`

**Interfaces:**
- Produces `listAvailableImageModels(): Promise<AvailableImageModel[]>`.
- Produces `resolveImageBackend(selection, available): AvailableImageModel | null`.
- Makes `runGenerateImageTool(chatProvider, args, signal)` route by selected image backend.
- Makes `runEditImageTool(chatProvider, prompt, images, signal)` route by selected image backend.

- [ ] **Step 1: Add failing routing cases**

Cover Azure chat + Ollama image generation, Azure chat + OpenAI image generation, OpenAI chat + selected Ollama generation, selected OpenAI generation, no selected backend, unavailable selected backend, and Ollama editing rejection.

- [ ] **Step 2: Implement backend-aware discovery**

Discover installed Ollama image models and enabled OpenAI image models independently. Do not include Azure deployments. Preserve provider identity in every returned entry.

- [ ] **Step 3: Route generation**

Read the persisted image selection, require that it is currently available, and dispatch to `generateImageBase64` for Ollama or `generateOpenAiImageBase64` for OpenAI. Never infer backend from a model name.

- [ ] **Step 4: Route editing**

Use `editOpenAiImageBase64` only for a selected OpenAI backend. Return the exact clear unsupported-operation result for a selected Ollama backend. Do not use the chat provider to select the image backend.

- [ ] **Step 5: Verify and commit**

Run:

```bash
node scripts/test-image-backend-routing.mjs
node scripts/test-image-gen-tool.mjs
npm run typecheck:node
```

Commit:

```bash
git add src/main/image-gen-tool.ts src/main/openai-image.ts scripts/test-image-backend-routing.mjs
git commit -m "feat: route image tools through selected backend"
```

## Task 3: Agent/provider integration

**Files:**
- Modify: `src/main/agent.ts`
- Modify: `src/main/agent-tool-boundary.ts`
- Modify: `src/main/llm/azure-openai-provider.ts` only if model capability handling needs adjustment
- Modify: `src/shared/types.ts` only if event metadata needs the backend identity

**Interfaces:**
- `runAgentTurn()` offers image tools for Azure/OpenAI/Ollama chat when an image backend is available.
- Image-tool dispatch passes the effective chat provider only for error/context reporting; backend selection comes from config.
- Direct Ollama/OpenAI image-model chat behavior remains unchanged.

- [ ] **Step 1: Add agent routing tests**

Check that image tools are offered for Azure chat when a selected image backend is available, omitted when no backend is available, and never interpreted as Azure-native image generation.

- [ ] **Step 2: Remove chat-provider-only gating**

Change `shouldOfferGenerateImageTool` calls so Azure no longer returns false solely because it is the chat provider. Offer the tool based on selected image backend availability and non-image chat model status.

- [ ] **Step 3: Preserve image-model direct paths**

Keep direct Ollama image generation and explicit OpenAI image-model handling intact. Azure deployments must never enter a native image-generation path.

- [ ] **Step 4: Keep editing boundary explicit**

Unexpected Azure edit calls should be handled by the selected image-backend route; selected Ollama editing returns unsupported, selected OpenAI editing executes.

- [ ] **Step 5: Verify and commit**

Run:

```bash
node scripts/test-image-backend-routing.mjs
npm run typecheck
npm run check:openai-vision
```

Commit:

```bash
git add src/main/agent.ts src/main/agent-tool-boundary.ts src/main/llm/azure-openai-provider.ts src/shared/types.ts scripts/test-image-backend-routing.mjs
git commit -m "feat: offer image tools for Azure chat"
```

## Task 4: IPC, preload, and Settings selector

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/components/Settings.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Adds `config:setImageBackend(selection | null)`.
- Adds `images:listAvailableModels(): Promise<AvailableImageModel[]>`.
- Settings receives grouped entries such as `OpenAI · gpt-image-1` and `Ollama · flux`.

- [ ] **Step 1: Add IPC/preload methods**

Expose sanitized image-backend selection and available image models. Image discovery must execute in the main process; renderer receives provider/model labels only.

- [ ] **Step 2: Add App state and refresh**

Load `imageBackend` from config, refresh available image models after Ollama/OpenAI model changes, and clear or preserve selection based on exact `{ provider, model }` identity.

- [ ] **Step 3: Add grouped Settings selector**

Replace the legacy default image model selector with a combined provider-grouped selector. Use a stable encoded value such as `${provider}:${model}` only for the HTML control; persist structured data. Include an Auto/None option and explain that editing requires OpenAI.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run typecheck
```

Start `npm run dev` and verify the Settings selector renders Ollama/OpenAI entries without showing credentials.

Commit:

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/src/components/Settings.tsx src/renderer/src/App.tsx
git commit -m "feat: add image backend settings selector"
```

## Task 5: Chat UI and end-to-end verification

**Files:**
- Modify: `src/renderer/src/components/Chat.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `scripts/test-image-backend-routing.mjs`

- [ ] **Step 1: Make image UI provider-aware**

Only treat Ollama models as Ollama image-generation models. OpenAI image models use existing explicit OpenAI handling. Azure deployment names/capabilities must never trigger image-model UI or suppress attachments.

- [ ] **Step 2: Verify fallback and selection transitions**

Test Azure chat with Ollama image backend, Azure chat with OpenAI image backend, switching image backends, unavailable selected backend, and preservation of chat-provider model slots.

- [ ] **Step 3: Run complete checks**

```bash
npm run typecheck
npm run build
node scripts/test-image-backend-routing.mjs
node scripts/test-image-gen-tool.mjs
node scripts/check-openai-vision.mjs
git diff --check
```

- [ ] **Step 4: Commit verification fixes**

If source fixes are required, commit them:

```bash
git add src/main src/preload src/renderer scripts
git commit -m "test: verify independent image backend routing"
```

## Plan self-review

- Structured image selection and legacy migration: Task 1.
- OpenAI/Ollama discovery and routing: Task 2.
- Azure chat tool availability and image boundaries: Task 3.
- Main-process discovery, IPC, Settings selector: Task 4.
- Provider-aware Chat UI, fallback transitions, regression checks: Task 5.
- Azure-native image generation remains a non-goal; selected OpenAI/Ollama backends are the only image APIs.

No placeholders or unassigned specification requirements remain.
