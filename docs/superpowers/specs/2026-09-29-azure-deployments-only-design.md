# Azure OpenAI: deployments only (no model catalog)

Date: 2026-09-29

## Problem

The Azure OpenAI Models tab shows a resource **model catalog** alongside manually managed **deployments**. Catalog entries are not usable for chat until a matching deployment exists, so the catalog adds noise without helping users configure Azure chat.

## Goal

Azure model management is **deployments only**: add, enable, remove, and select deployment names. Do not show, persist, or decorate with Azure `/openai/models` catalog data.

## Decisions

| Topic | Choice |
| --- | --- |
| UI | Deployments section only; remove catalog list and refresh |
| Persistence | Stop storing `azureOpenaiModelsCatalog`; clear on read |
| Deployment metadata | Drop `matchedCatalogMetadata`; no “catalog match” UI |
| Validation | Keep `GET …/openai/models` as credential/endpoint probe; discard body |
| Chat model list | Enabled deployments only (unchanged) |
| Vision / capabilities | Infer from deployment name via existing OpenAI name heuristics |
| OpenAI (non-Azure) catalog | Unchanged |

## Architecture

```
Settings Validate ──► GET /openai/models ──► ok/error only (no store)
Models Azure tab ──► deployments CRUD only
Chat dropdown     ──► enabled deployment names
Provider tags     ──► isOpenAiVisionModel(deployment.name) heuristics
```

1. Renderer Azure tab renders deployments UI only; copy about “load the model catalog” becomes validate-settings messaging.
2. Main validation IPC validates credentials via the models endpoint, sets validation flags, and does **not** call `mergeAzureOpenaiCatalog`.
3. Config read normalizes catalog to `[]` and strips `matchedCatalogMetadata` from deployments.
4. `azureOpenaiLlmProvider` lists enabled deployments without consulting a catalog; `detectVisionSupport` / tags use deployment name heuristics.

## UI

- Remove Model catalog heading, description, Refresh catalog button, and catalog list.
- Keep Deployments: add form, enabled checkbox, remove, “Selected in chat”.
- Remove “Catalog match” / “No catalog metadata match” lines.
- Empty / invalid states refer to validating settings and adding deployments, not loading a catalog.

## Data and IPC

- `azureOpenaiModelsCatalog` remains on the config type only if needed for migration compatibility; always expose `[]` to the renderer (or remove from renderer props entirely).
- `AzureOpenaiDeploymentEntry` no longer carries `matchedCatalogMetadata` in new writes; strip if present when reading.
- Validate / refresh handlers: validate only; no catalog merge.
- Deployment add/update/remove/enable IPC unchanged in behavior.

## Provider

- `listModelsForChat` / `getModelInfo`: deployment-based only.
- Do not call `getAzureOpenaiModelsCatalog` for tagging.
- Vision: treat as supported when `isOpenAiVisionModel(deployment.name)` (or equivalent name heuristic); otherwise `unknown` / no vision tag.
- Image gen for Azure remains unsupported.

## Error handling

- Failed validation still preserves existing deployments and clears or keeps prior validation error as today.
- Missing enabled deployments still yields the existing empty-state guidance for chat.
- Invalid deployment names fail at chat time as today (Azure HTTP error).

## Testing

- Validation success does not persist catalog entries.
- Deployment CRUD and enable/disable still work.
- Provider chat model list equals enabled deployments with no catalog dependency.
- Models page Azure tab has no catalog markup / props wiring for catalog display.

## Out of scope

- Automatic Azure deployment discovery
- Changing OpenAI (non-Azure) catalog UX
- Azure image generation
- Changing chat request URL shape (still deployment-in-path)

## Success criteria

- Azure Models tab shows only deployments.
- `config.json` does not accumulate Azure catalog payloads after validate/refresh.
- Enabled deployments still appear in the chat model dropdown and work for chat.
- Existing manually entered deployments survive the upgrade (metadata-only fields stripped).
