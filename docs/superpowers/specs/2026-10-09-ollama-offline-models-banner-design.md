# Ollama offline: unified message and Models tab gating

Date: 2026-10-09

## Problem

On **Models → Ollama**, users can pull and download models while Ollama is offline. The offline warning appears only in **Installed** view and uses different copy than Chat (`Ollama is offline — check Settings or switch to OpenAI.`). Users need a consistent offline message and disabled pull/download when Ollama is not connected.

## Goal

- Show the **same** user-facing offline line as Chat whenever the **Ollama** tab is active and `ollamaOk === false`.
- Disable **Download** (library list) and **Pull** (detail panel) when offline.
- Keep remote library browse available offline; only local pull/download requires Ollama.

## Decisions

| Topic | Choice |
| --- | --- |
| Canonical copy | `Ollama is offline — check Settings or switch to OpenAI.` (option A) |
| Where defined | Single constant in `src/shared/` |
| Chat behavior | Unchanged semantics; banner text sourced from shared constant |
| Models placement | One banner at top of Ollama tab body (both All models and Installed) |
| Models second line | Optional hint: pull/download disabled until Ollama runs (does not replace canonical line) |
| Settings | Keep Connected/Offline + technical `ollamaError`; no banner line change |
| Refresh / Delete / Use in chat | Out of scope for this change |

## Architecture

```
src/shared/ollama-offline-message.ts
  └── OLLAMA_OFFLINE_USER_MESSAGE

src/shared/chat-provider-banners.ts
  └── uses constant when effectiveProvider === 'ollama' && !ollamaOk

src/renderer/src/components/ModelsPage.tsx
  └── tab === 'ollama' && !ollamaOk → amber banner (canonical + optional hint)
  └── Download / Pull disabled + handler guards when !ollamaOk
```

`ollamaOk` continues to come from `App.tsx` via existing status polling; no new IPC.

## UI behavior

### Banner (Models → Ollama)

- Render when `tab === 'ollama'` and `!ollamaOk`.
- Position: top of Ollama tab scroll content, above the All models / Installed toggle.
- Styling: match existing amber info pattern used on Models (`border-amber-900/40 bg-amber-950/20 text-amber-200`).
- First line: `OLLAMA_OFFLINE_USER_MESSAGE` exactly.
- Second line (optional): short action hint, e.g. *Pull and download are disabled until Ollama is running.*
- Remove the Installed-only-only banner that says installed models cannot be refreshed (replaced by the shared banner).

### Download (library list, non-cloud, not installed)

- `disabled` when `!ollamaOk || pulling`.
- `title` when disabled due to offline: set to `OLLAMA_OFFLINE_USER_MESSAGE`.

### Pull (detail panel, local tags)

- `disabled` when `!ollamaOk || pulling || installed`.
- Same tooltip pattern when offline.

### Handlers

- `handlePull` and `handleDownloadFromList`: return immediately if `!ollamaOk` (defense in depth).

## Testing

- Unit test: `OLLAMA_OFFLINE_USER_MESSAGE` matches output of `chatProviderReadinessBanners` for `{ effectiveProvider: 'ollama', ollamaOk: false, configuredProvider: 'ollama' }`.
- Extend or mirror existing `scripts/test-chat-provider-banners.mjs` pattern (Vite SSR load of shared module).

Manual:

1. Stop Ollama → open Models → Ollama → banner visible in All models and Installed.
2. Banner text matches Chat when Ollama is configured provider and offline.
3. Download and Pull disabled; no pull progress when clicking (if somehow enabled).
4. Start Ollama → banner hides, buttons enable (subject to pulling/installed rules).

## Files (expected)

| File | Change |
| --- | --- |
| `src/shared/ollama-offline-message.ts` | New constant |
| `src/shared/chat-provider-banners.ts` | Import constant |
| `src/renderer/src/components/ModelsPage.tsx` | Banner placement, disable buttons, guards |
| `scripts/test-ollama-offline-message.mjs` or extend chat banner tests | Assert shared copy |
