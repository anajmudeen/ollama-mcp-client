# Fast session loading

Date: 2026-09-29

## Problem

Chat sessions persist full `uiMessages` (including multi-MB `data:image/...;base64,...` payloads) inside electron-store. Every `sessions:list`, `setActive`, `update`, and `sessions:changed` broadcast returns the entire `SessionsState` over IPC. With many generated images, `config.json` grows to tens of megabytes and session load/switch becomes slow.

`stripHeavyHistory` already omits images from model `history`. `uiMessages` still embed full data URLs for display.

## Goal

1. Keep chat images viewable after restart without embedding them in `config.json`.
2. Make list/switch/broadcast IPC cheap (metadata only).
3. Load a session’s `uiMessages` / `history` only when that session is opened.
4. Migrate existing inline images automatically on upgrade.

## Decisions

| Topic | Choice |
| --- | --- |
| Image storage | Files under `userData/session-images/<sessionId>_<fileId>.<ext>` |
| Message refs | `session-img://<fileId>` in `uiMessages[].images` |
| Protocol | Privileged custom scheme `session-img` (same pattern as `html-preview`) |
| Gallery reuse | No — gallery still stores base64 in electron-store |
| List/broadcast payload | `SessionSummary` only (no bodies) |
| Full body fetch | New `sessions:get(id)` |
| Externalize timing | On `updateSession` and during migration |
| Migration | Active session sync on first load; remaining sessions in background after UI up |
| Delete session | Delete matching `sessionId_*` image files |

## Architecture

```
config.json (summaries + refs) ──► sessions:list / sessions:changed
                                          │
                                          ▼
                                    Sidebar metadata

session-images/*.png ──► session-img protocol ──► <img src>
         ▲
         │
sessions:get(active) ──► Chat uiMessages (refs) ──┘
```

1. Main externalizes any inline image in `uiMessages` before persisting.
2. Renderer boots with `list` then `get(activeSessionId)`.
3. Session select: `setActive` then `get`.
4. `onChanged` updates sidebar summaries only; never replaces open-chat messages from the broadcast payload.
5. Live turns may still hold data URLs in renderer memory until reload; persisted form uses refs.

## API

- `SessionsListState`: `{ sessions: SessionSummary[]; activeSessionId; telegramActiveSessionId }`
- `SessionSummary`: `id`, `title`, `createdAt`, `updatedAt`, `origin`
- `sessions:list` / `create` / `setActive` / `delete` / `changed` → `SessionsListState`
- `sessions:get(id)` → `ChatSession | null`
- `sessions:update` → updated `SessionSummary`

## Migration

1. On sessions cache load: if any message still has inline images, externalize the **active** session and persist.
2. After first `sessions:list`: background-externalize remaining sessions; persist once.
3. Idempotent: leave existing `session-img://` refs alone.

## Success criteria

- `config.json` contains no multi-MB data URLs after migration.
- List/switch IPC carries summaries only.
- Image-heavy chats still render via `session-img://`.
- Existing chats remain viewable after upgrade.
