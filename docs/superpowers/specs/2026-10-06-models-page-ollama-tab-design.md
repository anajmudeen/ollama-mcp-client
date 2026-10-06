# Models page: Ollama tab and installed filter

Date: 2026-10-06

## Problem

The Models page uses four top-level tabs — **Installed**, **OpenAI**, **Azure OpenAI**, and **library** — which splits Ollama “what I have” vs “what I can pull.” Users want a single **Ollama** surface: library browse by default, **Installed** as a filter (not a tab), installed families visible in browse via badge and sort order, and README only for Ollama-backed detail (not cloud catalogs).

## Goal

Restructure Models navigation and the Ollama experience:

- Top tabs: **Ollama** · **OpenAI** · **Azure OpenAI** (cloud tabs only when enabled).
- Under **Ollama**: default **library browse**; **Installed** filter shows local models **grouped by family** (one row per base name; tags in detail).
- In browse: families already on disk are **badged** and **sorted above** other library results (stable order within each group).
- Capability chips apply in **both** browse and Installed filter modes.
- README in the side panel **only** for Ollama library/local/family detail — never for OpenAI or Azure lists.

## Decisions (brainstorming)

| Topic | Choice |
| --- | --- |
| Default Ollama view | Library browse (search, sort, infinite scroll) |
| Installed in browse | Badge + installed families sorted to top |
| Installed filter | Local rows grouped by family (`localBaseName`); tags in detail |
| Top tabs | Ollama · OpenAI · Azure (when enabled); drop Installed and library tabs |
| Capability chips | Filter in browse **and** Installed modes |
| README | Ollama detail only |

## Architecture

```
ModelsPage tabs: ollama | openai | azure
        │
        ▼
Ollama tab
  ├── mode: browse (default) ──► library API + infinite scroll
  │         • badge if isInstalledFamily(local, name)
  │         • stable sort: installed families first
  └── mode: installed filter ──► group local models by localBaseName
            • one list row per family
            • detail: all tags, actions, README at family level

OpenAI / Azure tabs ──► unchanged list UX, no README panel
```

Primary change: `src/renderer/src/components/ModelsPage.tsx` (tab type, shared Ollama filter bar, list branches, detail panel labels).

## Navigation and copy

- Replace `ModelsTab = 'installed' | 'library' | 'openai' | 'azure'` with `'ollama' | 'openai' | 'azure'`.
- Default selected tab: **ollama**.
- Tab order: `ollama`, then `openai` if enabled, then `azure` if enabled.
- Update header subtitle to reflect Ollama + cloud catalogs (no “library” tab name in UI).

## Ollama filter bar (shared)

- **View toggle** (not a top tab): **All models** (library browse) vs **Installed** (grouped locals). Persist as component state (e.g. `ollamaInstalledOnly: boolean`).
- **Search:** library query in browse; filter grouped families (and optionally tag names) in Installed mode.
- **Sort:**
  - Browse: existing Popular / Newest / Smallest / Largest (library API + client size sort where applicable).
  - Installed: Name / Smallest / Largest applied per **family** (smallest/largest = min/max tag size in family).
- **Capability chips:** reuse library capability filters in browse; in Installed mode, match if **any tag in the family** has the capability/tag (align with today’s installed cap chips including `image` where used).
- **Refresh:** in Installed mode, **Refresh** calls `onRefreshModels()`; browse behavior unchanged.

## Browse mode (All models)

- Keep current library list, pagination/sentinel, pull/download actions.
- **Badge** on card when `isInstalledFamily(models, summary.name)` (e.g. “Installed” or consistent ✓ styling used elsewhere).
- **Sort:** after merging a page of results, **stable partition**: installed families first, then others; preserve API order within each partition (do not re-sort entire list by popularity across partitions).

## Installed filter mode

- Group `models` by `localBaseName(name)`.
- One row per family: base name, tag count, summary line (sizes/dates), **Active** if any tag equals `selectedModel`.
- Row click opens **family detail**:
  - List each local tag with size, modified, delete, Use in chat.
  - **README** once at family level via `getLibraryReadme(baseName)` (same as today for locals/library).
  - Optional per-tag metadata (capabilities, system, template) — show per tag in the list or on tag expand; README stays family-level only.

Implement `detailKind` extension (e.g. `'local-family'`) or equivalent so the aside is not tied to a single tag name only.

## Detail panel and README

- Show README section only for Ollama detail kinds: local, local-family, remote (library catalog).
- OpenAI and Azure: no detail README; no new readme fetch for cloud models.
- Aside subtitle: **Ollama** (replace “Installed” / “Library” labels).

## Edge cases

- **Ollama offline:** warning on Ollama tab; Installed filter shows last-known local list; library shows existing error/empty states.
- **Installed filter, empty disk:** empty state with hint to switch to All models and pull.
- **Pull progress:** unchanged global bar above the split pane.

## Non-goals

- Redesign OpenAI/Azure list layouts beyond tab naming/order.
- Chat model picker or Telegram changes.
- New IPC endpoints (reuse `ollama` list/show/delete/pull and library APIs).

## Testing

- Manual: tab set; default Ollama; All vs Installed toggle; badge and installed-first order in browse; family grouping and tag actions; capability chips in both modes; README on Ollama detail only; OpenAI/Azure without README.
- Optional: unit test for `groupLocalModelsByFamily` helper if extracted.

## Success criteria

- No top-level Installed or library tabs; Ollama is the single entry for local + catalog.
- Installed filter shows one row per family with tags in detail.
- Browse shows installed badge and installed families above others.
- README appears only in Ollama-related detail panels.
