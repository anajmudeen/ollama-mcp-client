# Task 3 Review Report

## Scope

Reviewed `7a05045..HEAD`, including:

- `src/renderer/src/components/ImageGeneration.tsx`
- `.superpowers/sdd/2026-09-28-task-3-report.md`
- Existing contracts in `ImageLightbox.tsx`, `DownloadImageButton.tsx`, and
  `CopyButton.tsx`

## Spec Compliance: PARTIAL

Implemented correctly:

- Studio split with left-side model/prompt controls and right-side image preview
  (`ImageGeneration.tsx:217-293`).
- Independent concurrent model and gallery requests via `Promise.allSettled`
  (`ImageGeneration.tsx:47-52`).
- Local state is isolated to the component and includes models, selected model,
  prompt, gallery, selected preview, loading, and error
  (`ImageGeneration.tsx:38-45`).
- First available model selection and no-model setup guidance
  (`ImageGeneration.tsx:55-69`, `ImageGeneration.tsx:202-215`).
- Generation sends the selected provider, model, and trimmed prompt only
  (`ImageGeneration.tsx:116-120`), rejects blank prompts, disables the Generate
  button while generating, and preserves form state on success/failure
  (`ImageGeneration.tsx:101-114`, `ImageGeneration.tsx:259-266`).
- Successful results are prepended to the gallery, persistence errors preserve
  the generated image and show a warning (`ImageGeneration.tsx:126-147`,
  `ImageGeneration.tsx:295-299`).
- Gallery preview, download, copy-prompt, and delete actions are present and
  use the existing component contracts (`ImageGeneration.tsx:310-355`).
- No edit or regenerate controls were added.

Findings:

1. **S2 / Medium — Initial loading is indistinguishable from “no models”.**
   `models` starts empty and there is no initial-load state. Before discovery
   resolves, the component renders “Set up an image model” and the no-model
   retry UI (`ImageGeneration.tsx:38`, `ImageGeneration.tsx:202-215`). This is
   misleading during normal startup and does not satisfy the requested loading
   behavior. Add a separate discovery-loading state and render setup guidance
   only after model discovery successfully returns an empty list.

2. **S2 / Medium — Stale load responses can overwrite newer state.**
   Every activation and retry calls `load`, but there is no request generation,
   cancellation, or mounted/current-request guard (`ImageGeneration.tsx:47-90`).
   A slower earlier model/gallery request can therefore replace a newer retry’s
   result, contrary to the plan’s “preserve the latest request result”
   requirement. Guard each result with a request token or abort/cancellation
   mechanism.

3. **S3 / Low — The large preview is no longer guaranteed to remain newest.**
   `newest` is derived from `selectedPreview` before falling back to
   `gallery[0]` (`ImageGeneration.tsx:96-99`). Clicking any gallery item changes
   `selectedPreview` (`ImageGeneration.tsx:312-317`), so after closing the
   lightbox the right-hand “newest result” pane displays the older selected
   item. Keep lightbox selection separate from the newest-result state, or reset
   the large preview after the lightbox closes.

4. **S3 / Low — Gallery filenames can contain invalid compound extensions.**
   The component bypasses `DownloadImageButton`’s MIME normalization by supplying
   `item.mime.split('/')[1]` directly (`ImageGeneration.tsx:328-330`). For
   `image/svg+xml`, this produces an `svg+xml` filename extension. Use the
   button’s default filename or normalize the subtype before constructing the
   filename.

## Task Quality: NEEDS CHANGES

The component is well-scoped, readable, uses the requested existing contracts,
and passes type checking, but the initial loading state and stale-request race
are behavior defects in the requested loading/error flow. The large-preview
selection issue and MIME filename edge case are lower-severity polish concerns.
No focused renderer tests were added; the repository has no configured renderer
test runner or established renderer test convention, so the listed behaviors
remain manually verified only.

## Commit

- `5f3088e3ac8b0796a7f2a69289d3c5ef30beb46b`

## Verification

- `npm run typecheck:web` — passed.
- `git diff --check 7a05045..HEAD` — passed.
- `git status --short` — only pre-existing untracked `.superpowers/brainstorm/`
  artifacts remain; no implementation files were modified by this review.

## Review fixes

- Added a separate discovery-loading state and only show setup guidance after
  successful empty model discovery.
- Added activation/retry request tokens plus effect cleanup to ignore stale
  model/gallery responses.
- Separated the newest-result pane from lightbox selection so older gallery
  previews do not replace the newest pane.
- Removed the explicit gallery filename extension so
  `DownloadImageButton` safely normalizes MIME types.

## Fix verification

- `npm run typecheck:web` — passed.
- `git diff --check` — passed.
- IDE lints for `src/renderer/src/components/ImageGeneration.tsx` — no errors.

## Fix concerns

- No focused renderer tests were added because the repository still has no
  configured renderer test runner or established renderer test convention.
