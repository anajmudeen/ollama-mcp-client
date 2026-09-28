# Image Generation Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Image sidebar workspace that generates images with selected Ollama/OpenAI image models and persists a full gallery across restarts.

**Architecture:** Keep image-page state in a dedicated renderer component, expose narrowly typed image IPC methods through the preload bridge, and persist gallery records in the main-process electron-store. Reuse `listAvailableImageModels`, `ollama-image.ts`, and `openai-image.ts`, but add an explicit selected-backend generation path so the page does not depend on the Settings backend selection or active chat LLM.

**Tech Stack:** Electron main/preload IPC, React 19, TypeScript, electron-store, Tailwind CSS, existing Ollama/OpenAI image clients.

## Global Constraints

- Image generation remains independent of the active Chat LLM, including Azure OpenAI.
- The model selector must contain only image-capable, currently available Ollama/OpenAI models.
- Initial controls are only model and prompt; do not add size, aspect ratio, or provider-specific advanced options.
- Persist image data, prompt, provider/model, and timestamp for every successful generation.
- Gallery actions are preview, download, copy prompt, and delete; do not add edit or regenerate actions.
- Do not expose OpenAI or Azure API keys through renderer-facing configuration or IPC results.
- Preserve existing image-backend migration behavior and Chat/session state.

---

## File map

- Create `src/shared/image-gallery.ts`: shared gallery record type and runtime-safe normalization helpers.
- Modify `src/shared/types.ts`: expose the gallery and generation result types used by preload and renderer.
- Modify `src/main/config-store.ts`: persist and validate the gallery collection.
- Modify `src/main/image-gen-tool.ts`: add explicit-provider/model generation while retaining chat-tool behavior.
- Modify `src/main/ipc.ts`: register validated gallery and generation handlers.
- Modify `src/preload/index.ts`: expose typed `images.generate`, `images.listGallery`, and `images.deleteGalleryItem`.
- Create `src/renderer/src/components/ImageGeneration.tsx`: studio-split Image workspace.
- Modify `src/renderer/src/components/Sidebar.tsx`: add the Image view and icon.
- Modify `src/renderer/src/App.tsx`: add Image view routing and render the component without coupling it to Chat.
- Add focused pure-helper tests or a repository-compatible test script for gallery normalization, model filtering, and selected-backend validation; always run both TypeScript projects.
- Add `docs/superpowers/plans/...` only as this plan; implementation commits should be separate and reviewable.

## Task 1: Define gallery data contracts and persistence

**Files:**
- Create: `src/shared/image-gallery.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/config-store.ts`
- Test: focused gallery normalization tests in the repository’s existing test location, or a new `scripts/test-image-gallery.mjs` if no test runner is present

**Interfaces:**
- `ImageGalleryItem = { id: string; imageBase64: string; mime: string; prompt: string; provider: ImageBackendProvider; model: string; createdAt: string }`
- `listImageGallery(): ImageGalleryItem[]`
- `addImageGalleryItem(input: Omit<ImageGalleryItem, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): ImageGalleryItem`
- `deleteImageGalleryItem(id: string): boolean`
- `normalizeImageGallery(value: unknown): ImageGalleryItem[]`

- [ ] **Step 1: Write failing normalization cases**

Cover a valid item, missing fields, invalid provider, empty base64, invalid timestamp, duplicate IDs, and a missing collection. The expected result is a safe list containing only normalized valid items.

```ts
const item = normalizeImageGallery({
  id: 'img-1',
  imageBase64: 'YWJj',
  mime: 'image/png',
  prompt: 'A blue house',
  provider: 'ollama',
  model: 'x/z-image-turbo',
  createdAt: '2026-09-28T00:00:00.000Z'
})
expect(item).toHaveLength(1)
expect(normalizeImageGallery({ provider: 'azure-openai' })).toEqual([])
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run the repository-compatible focused test command selected after inspecting the existing test setup. If there is no test runner, run `node scripts/test-image-gallery.mjs` and expect failure because `src/shared/image-gallery.ts` does not yet exist.

- [ ] **Step 3: Implement the shared type and normalization**

Accept only `provider === 'ollama' || provider === 'openai'`, non-empty strings for IDs, base64, prompts, and models, `image/*` MIME types, and parseable ISO timestamps. Deduplicate by ID while preserving the first valid item. Return newest-first from the main-process list function.

- [ ] **Step 4: Add electron-store persistence**

Extend `StoreSchema` with `imageGallery: ImageGalleryItem[]`, default it to `[]`, read it through `normalizeImageGallery`, and write only normalized records. `addImageGalleryItem` generates `randomUUID()` and `new Date().toISOString()` when omitted, prepends the item, and returns it. `deleteImageGalleryItem` returns `false` for an unknown ID and never throws.

- [ ] **Step 5: Run focused tests and typecheck**

Run the focused gallery test, `npm run typecheck:node`, and `npm run typecheck:web`. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/image-gallery.ts src/shared/types.ts src/main/config-store.ts scripts/test-image-gallery.mjs
git commit -m "feat: persist image gallery records"
```

## Task 2: Add explicit image generation and IPC

**Files:**
- Modify: `src/main/image-gen-tool.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/types.ts`
- Test: image model selection and IPC-adjacent pure helper tests

**Interfaces:**
- `ImageGenerationRequest = { provider: ImageBackendProvider; model: string; prompt: string }`
- `ImageGenerationResult = { ok: true; model: string; provider: ImageBackendProvider; imageBase64: string; mime: string } | { ok: false; message: string }`
- `generateImageForBackend(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult>`
- `window.api.images.generate(request): Promise<ImageGenerationResult>`
- `window.api.images.listGallery(): Promise<ImageGalleryItem[]>`
- `window.api.images.deleteGalleryItem(id: string): Promise<boolean>`

- [ ] **Step 1: Write failing selected-backend tests**

Test that a request is rejected for an empty prompt, a provider outside `ollama | openai`, or a model not present in `listAvailableImageModels()`. Test that available Ollama and OpenAI entries are accepted and that the result includes provider, model, base64, and `image/png` MIME.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run the focused image test command. Expected: missing `generateImageForBackend` or equivalent failure.

- [ ] **Step 3: Implement explicit routing**

In `image-gen-tool.ts`, validate the request against `listAvailableImageModels()`. For Ollama call `generateImageBase64(model, prompt, signal)`; for OpenAI call `generateOpenAiImageBase64(model, prompt, signal)`. Do not read `getImageBackend()` in this page-specific function. Preserve `runGenerateImageTool` unchanged for Chat tool calls.

- [ ] **Step 4: Register handlers**

Add handlers in `registerIpc`:

```ts
ipcMain.handle('images:generate', async (_event, request: ImageGenerationRequest) => {
  const result = await generateImageForBackend(request)
  if (!result.ok) return result
  const item = addImageGalleryItem({
    imageBase64: result.imageBase64,
    mime: result.mime,
    prompt: request.prompt.trim(),
    provider: result.provider,
    model: result.model
  })
  return { ...result, galleryItem: item }
})
ipcMain.handle('images:listGallery', () => listImageGallery())
ipcMain.handle('images:deleteGalleryItem', (_event, id: string) =>
  deleteImageGalleryItem(id)
)
```

Validate request object, trim prompt/model, and require a string deletion ID before calling storage. Do not return credentials.

- [ ] **Step 5: Expose typed preload methods**

Import the shared request/result/gallery types and add the three methods under `api.images`. The renderer must invoke IPC only through these methods.

- [ ] **Step 6: Run tests and typecheck**

Run focused image tests plus `npm run typecheck:node` and `npm run typecheck:web`. Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/image-gen-tool.ts src/main/ipc.ts src/preload/index.ts src/shared/types.ts
git commit -m "feat: expose dedicated image generation IPC"
```

## Task 3: Build the Image studio-split component

**Files:**
- Create: `src/renderer/src/components/ImageGeneration.tsx`
- Reuse: `src/renderer/src/components/ImageLightbox.tsx`
- Reuse: `src/renderer/src/components/DownloadImageButton.tsx`
- Reuse: `src/renderer/src/components/CopyButton.tsx`

**Interfaces:**
- Props: `{ active: boolean }`
- Local state: `models`, `selectedModel`, `prompt`, `gallery`, `selectedPreview`, `loading`, `error`

- [ ] **Step 1: Add renderer behavior tests or a manual test checklist**

Cover model-only filtering, no-model empty state, prompt validation, successful insertion at the front of gallery, error state preserving form values, delete, copy prompt, preview, and download.

- [ ] **Step 2: Implement initial loading**

On mount, call `window.api.images.listAvailableModels()` and `window.api.images.listGallery()` independently. Preserve the latest request result, select the first available model if the current one disappeared, and show a retryable error if either load fails.

- [ ] **Step 3: Implement the studio split**

Render a left control panel with an image-model selector, prompt textarea, and Generate button. Render the newest result in a large right preview. Render persistent history below with provider/model and timestamp. Use existing dark-panel styling and avoid Chat-specific components/state.

- [ ] **Step 4: Implement generation**

Disable Generate while loading, reject blank prompts inline, call `window.api.images.generate({ provider, model, prompt })`, prepend `galleryItem` on success, set the large preview, and retain prompt/model after both success and failure. Display returned errors inline.

- [ ] **Step 5: Implement gallery actions**

Use `ImageLightbox` for preview, `DownloadImageButton` for download, `navigator.clipboard.writeText(item.prompt)` for copy prompt with local success feedback, and `window.api.images.deleteGalleryItem(item.id)` for deletion. If the deleted item is the current preview, select the next newest item or clear the preview.

- [ ] **Step 6: Run typecheck**

Run `npm run typecheck:web` and fix all errors before integration.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/ImageGeneration.tsx
git commit -m "feat: add image generation studio workspace"
```

## Task 4: Integrate Image navigation without affecting Chat

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/App.tsx`
- Test: renderer navigation smoke coverage or manual Electron smoke checklist

**Interfaces:**
- Extend `AppView` and App `view` state with `'image'`.
- Add `{ id: 'image', label: 'Image', icon: NavIconImage }`.
- Render `<ImageGeneration active={view === 'image'} />`.

- [ ] **Step 1: Write the navigation assertion**

Assert that the sidebar exposes an Image navigation item and that selecting Image changes only the application view, not active session, selected chat model, or Chat queue state.

- [ ] **Step 2: Add the Image icon and union member**

Add a small image/spark icon consistent with existing inline SVG icons. Update the Sidebar callback type and App navigation target union to include `image`.

- [ ] **Step 3: Render the Image view**

Import `ImageGeneration` in `App.tsx`, add the `image` view branch, and keep Chat rendered only when `view === 'chat'`. Do not call `leaveCurrentSession`, change active sessions, or change effective LLM provider when navigating to Image.

- [ ] **Step 4: Run all checks**

Run `npm run typecheck`, then launch the app with `npm run dev` and verify:

1. Image appears beside Chat.
2. Image lists only available image models.
3. A generated image appears in the large preview and gallery.
4. Restarting the app restores the gallery item.
5. Preview/download/copy/delete work.
6. Chat session and active model remain unchanged after switching views.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx
git commit -m "feat: add image sidebar navigation"
```

## Task 5: Final verification and review

**Files:**
- Modify only files needed to fix verified failures.

- [ ] **Step 1: Run complete verification**

Run:

```bash
npm run typecheck
npm run build
git diff main...HEAD --check
git status --short
```

Expected: typecheck and build succeed, diff check has no whitespace errors, and only intentional implementation files are changed. The untracked `.superpowers/brainstorm/` mockup artifacts should be removed or ignored before handoff; they are not part of the application feature.

- [ ] **Step 2: Verify persistence failure behavior**

Temporarily make gallery storage reject in a development-only test seam or unit test. Confirm the generated image remains visible and the UI reports that it was not saved, rather than silently claiming persistence.

- [ ] **Step 3: Verify secret boundaries**

Inspect the renderer-facing config and image IPC results to confirm neither OpenAI nor Azure API keys are included.

- [ ] **Step 4: Commit any fixes**

```bash
git add <verified-fix-files>
git commit -m "fix: finalize image workspace verification"
```

## Coverage check

- Navigation and Chat isolation: Task 4.
- Image-only model discovery and provider routing: Task 2 and Task 3.
- Full gallery persistence and migration-safe empty defaults: Task 1.
- Preview/download/copy/delete: Task 3.
- Loading, failure, no-model, invalid-selection, and persistence states: Tasks 2–3.
- Type safety and production build: Tasks 4–5.
