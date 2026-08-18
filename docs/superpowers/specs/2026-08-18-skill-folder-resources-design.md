# Skill folder resources

Date: 2026-08-18

## Problem

Skills created in the UI are already stored as `{userData}/skills/{id}/SKILL.md`, but the Skills page cannot open that folder, catalog **Add** copies only `SKILL.md`, and there is no way to import a local skill folder that also has templates or other files.

## Goal

Keep the existing on-disk layout. Let the user open the skills root or a single skill folder. When adding from the GitHub catalog or from a local folder, copy the whole skill tree (`SKILL.md` plus extra files). Chat still only sees `SKILL.md`.

## Non-goals

- Moving skills out of Electron `userData` or making the path configurable
- An in-app file manager (add/remove/preview extra files in the UI)
- Injecting extra file listings or contents into the model context
- Following extra files via tools (no new `read_skill_file` tool)
- Automated or manual test suites

## Approach

Extend the current disk layout and installer. Extra files are opaque blobs on disk. The in-app editor continues to read and write only `SKILL.md`. Finder/Explorer is how the user manages templates.

## On-disk layout

Root: `{app.getPath('userData')}/skills/`.

Each skill is a directory named by its slug id. `SKILL.md` is required for the app to list the skill.

```
skills/
  html-canvas-game/
    SKILL.md
    templates/
      game.html
  pr-review/
    SKILL.md
```

Rules:

- **Create / Edit** in the UI writes only `SKILL.md`. Other files in that directory are left untouched.
- **Delete** removes the whole skill directory.
- Chat, slash-complete, `load_skill`, and skill system context use `SKILL.md` only. Extra files matter only if the markdown mentions them.

## UI

On **My skills**, beside **+ New skill**:

- **Open folder** — opens the skills root in the OS file manager. Creates the root if it is missing.
- **Add from folder…** — native directory picker. On success, the skill appears in the list, enabled.

Each skill card also has **Open folder**, which opens that skill’s directory.

Catalog **Add** stays the same control. It copies the entire GitHub skill folder, not only `SKILL.md`. Duplicate names still show as already added.

Canceling the directory picker is a no-op (no error banner).

## Import and catalog copy

Both paths use one installer:

1. Resolve `SKILL.md` (prefer `SKILL.md`, else `skill.md`). Missing → error: `This folder is not a skill (missing SKILL.md).`
2. Parse name and description from frontmatter. Missing name → error.
3. If another installed skill has the same name (case-insensitive) → existing clash error; copy nothing.
4. Allocate a unique slug id (same `slugifySkillName` / `uniqueId` as today).
5. Copy the tree into `{userData}/skills/{id}/`.
6. Enable the skill.
7. On any failure after the destination directory is created, delete that directory (no half-installed skill).

Copy as-is (do not re-serialize `SKILL.md`), so extra frontmatter is kept.

### Local folder

`dialog.showOpenDialog({ properties: ['openDirectory'] })` from the Skills window.

Refuse a folder that is already inside the skills root (avoid nested copies).

Copy only files whose resolved path stays under the source folder (no `..`, do not follow symlinks out of the source). Skip directory names `.git` and `node_modules`, and files named `.DS_Store`. Copy everything else, including `LICENSE` and nested folders such as `templates/`.

### Catalog

For catalog id `{safe}`, recurse the GitHub Contents API under `skills/{safe}/` in `anthropics/skills` (same API the catalog list already uses) and download each file into the new skill directory, using the same skip rules and limits as local import. Do not fetch only `SKILL.md`.

### Limits (local and catalog)

- Max **50** files
- Max **1 MB** per file
- Max **5 MB** total uncompressed

Over any limit → fail with an error that names the limit; remove the destination if it was created.

## Errors

| Case | Behavior |
| --- | --- |
| No `SKILL.md` / `skill.md` | Error banner; nothing copied |
| Duplicate skill name | Existing clash message; nothing copied |
| Over file/size limits | Error names the limit; dest removed |
| Open folder fails | Error banner; app stays up |
| Picker canceled | No-op |
| Catalog/network failure mid-copy | Dest removed; show the error |
| Import path is already under skills root | Error; nothing copied |

## Components

- `src/main/skills.ts` — shared tree copy, local install, `openSkillsRoot` / `openSkillDir` via `shell.openPath`, preserve extra files on upsert (already true if upsert only writes `SKILL.md`).
- `src/main/skill-catalog.ts` — recursive catalog download into the shared installer.
- `src/main/ipc.ts` + `src/preload/index.ts` — `skills:openRoot`, `skills:openDir`, `skills:importFromFolder`.
- `src/renderer/src/components/SkillsPage.tsx` — header and per-card **Open folder**, **Add from folder…**.

No change to chat prompting, `load_skill`, or slash skills beyond listing newly imported skills as they do today.

## Testing

None. Out of scope at the user’s request.
