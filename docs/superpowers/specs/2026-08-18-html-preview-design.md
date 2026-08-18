# HTML fence preview

Date: 2026-08-18

## Problem

Chat renders fenced code with `CodeBlock` (highlight + Copy). Mermaid is the only special language. When the model emits a full HTML document (pages, canvas games), the user has to copy the source out of the app to see it.

## Goal

When a completed markdown fence is a full HTML document, default to an in-chat HTML preview. The user can switch to highlighted source, download the file, and explicitly Run pages that need JavaScript.

## Non-goals

- Stop / Reload controls (switching to Source unloads the guest)
- Remembering Allow/Deny across Runs
- Fullscreen preview
- Previewing HTML *fragments* that are not documents (for example `` ```html `` with only a `<div>`)
- Previewing clearly non-HTML languages even if the body contains tags
- Opening preview in a separate window or `<webview>`
- Automated tests (deferred)

## Approach

Sandboxed iframe plus a privileged custom protocol `html-preview:`. The chat page CSP stays `script-src 'self'`; guest HTML is never injected into the renderer DOM.

This mirrors mermaid: `MarkdownContent` special-cases the fence and mounts a dedicated component.

## Detection

A fence is an HTML document when **both** are true:

1. **Language** is `html`, `htm`, `xml`, or empty (missing / unlabeled). Any other language (`js`, `python`, `svg`, …) stays a normal `CodeBlock`.
2. **Body** looks like a document: case-insensitive match for `<!DOCTYPE html` or a start tag `<html` followed by whitespace, `>`, or `/`.

Serialized compact fences (the existing mermaid/code path) use the same rules.

**Interactive vs static** (body only, after it is a document):

- Needs Run if the source contains a `<script` or `<canvas` start tag (case-insensitive).
- Otherwise static: Preview iframe with scripts disabled, no Run button.

**Remote scripts** (checked only on Run): a `<script>` tag whose `src` is `http:`, `https:`, or protocol-relative `//`. Inline scripts and `data:` scripts are not remote.

## UI

`HtmlPreview` wraps the block.

Toolbar, always visible:

- Segmented **Preview | Source**. Default: Preview.
- **Download** — saves the original fence text as `ollama-html-<timestamp>.html` (renderer blob download, same pattern as images).

**Source** reuses `CodeBlock` (highlight + Copy). Switching to Source unmounts the iframe and destroys the preview ID. That is how a running page is torn down.

**Preview body**

| Kind | What the user sees |
| --- | --- |
| Streaming (assistant message still open) | Normal `CodeBlock` only. Do not create a preview ID. |
| Static document | Iframe immediately, scripts disabled. |
| Needs JS (`<script>` or `<canvas>`) | Poster: short copy that the page needs to run, plus **Run**. |
| After Run | Iframe with scripts, left running until Source. |
| Remote scripts on Run | In-block **Allow** / **Deny** before the iframe is created. Every Run asks again. |

**Allow** creates the guest with remote scripts enabled. **Deny** creates it with inline JS only. Switching to Source (or unmounting) while the prompt is open cancels Run — no iframe is created.

## Architecture

```
MarkdownContent
  └─ HtmlPreview
        ├─ toolbar (Preview | Source, Download, Run)
        ├─ CodeBlock          (Source mode)
        ├─ poster / prompt    (needs Run)
        └─ iframe             (src = html-preview://<id>/)
                 │
                 ▼
        IPC htmlPreview:create / destroy
                 │
                 ▼
        Main: in-memory map id → { html, allowScripts, allowRemoteScripts }
        Protocol handler html-preview: serves HTML with guest CSP
```

### Main process

Register `html-preview` as a privileged standard/secure scheme **before** `app.ready`. Handle requests by preview ID. Unknown IDs return 404. HTML lives only in the map; destroy deletes it.

On window close / session teardown, destroy leftover IDs.

### Guest iframe

- **Never** `allow-same-origin`.
- Static: `sandbox` without `allow-scripts`.
- Run: `sandbox="allow-scripts"` (no popups, no downloads from inside the guest).
- Height: ~420px, scroll inside the iframe if the page is taller. Not fullscreen.

### CSP

Parent (`src/renderer/index.html`): keep current policy; add `frame-src html-preview:`.

Guest (response headers on `html-preview:`):

| Mode | Script policy (intent) |
| --- | --- |
| Static | `script-src 'none'` |
| Run + Deny | Inline / eval / `blob:` only; no `http:`/`https:` scripts |
| Run + Allow | Inline / eval / `blob:` plus `http:`/`https:` scripts |

Styles: `'unsafe-inline'`. Images: `data:` plus `http:`/`https:` (remote images are allowed without a prompt; only remote *scripts* are gated). `connect-src` follows the same Allow/Deny split as scripts so fetch/XHR cannot bypass Deny.

## IPC / preload

- `htmlPreview:create({ html, allowScripts, allowRemoteScripts }) → { id, url }`
- `htmlPreview:destroy(id) → void`

Create is idempotent per mount cycle: each visible iframe has one ID; Source or unmount destroys it. Run after Source creates a new ID (and re-prompts for remote scripts).

Download does not use IPC.

## Data flow

1. Completed fence + detection → `HtmlPreview` in Preview mode.
2. Static → `create` with `allowScripts: false` → iframe.
3. Poster → wait for Run → optional Allow/Deny → `create` with `allowScripts: true` and `allowRemoteScripts` from the choice → iframe.
4. Source → unmount iframe → `destroy`.
5. Download → blob of fence text in the renderer.

## Error handling

- Invalid HTML: still serve it; the guest browser shows what it can. No linting.
- IPC or protocol failure: keep Source and Download; Preview shows a short inline error. Run may retry with a new ID.
- Iframe crash / blank guest: same error; Run retries.
- Streaming: never `create` until the assistant message completes.
- Allow/Deny prompt: Source or unmount cancels Run (no guest). Deny still creates a guest without remote scripts.
- Unknown preview ID: 404 from the protocol handler.

## Files (expected)

- `src/renderer/src/components/HtmlPreview.tsx` — UI, poster, prompt, iframe
- `src/renderer/src/lib/htmlFence.ts` — detection helpers (document, needs Run, remote scripts)
- `src/renderer/src/components/MarkdownContent.tsx` — branch like mermaid
- `src/renderer/src/styles.css` — preview chrome
- `src/renderer/index.html` — `frame-src html-preview:`
- `src/main/html-preview.ts` — scheme registration, map, CSP
- `src/main/index.ts` / `ipc.ts` / preload — wire IPC and register scheme before ready
- `src/shared/types.ts` — create payload / result types

## Success criteria

- Markup-only HTML documents preview without Run.
- Canvas / script documents show a poster until Run, then run in the sandbox.
- Remote `<script src>` prompts Allow/Deny on every Run.
- Source shows highlighted HTML and unloads the guest.
- Download saves a `.html` file of the original fence.
- Chat page scripts stay isolated from guest HTML (`script-src 'self'`, no `allow-same-origin`).
