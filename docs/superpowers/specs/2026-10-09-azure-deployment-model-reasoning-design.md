# Azure deployments: model name and reasoning effort

Date: 2026-10-09

## Problem

Azure chat uses **deployment names** in the API path, but capability heuristics (including `reasoning_effort`) run against that deployment string. Names like `prod-chat` do not match `openAiModelUsesReasoningEffort`, so the chat **Effort** picker stays hidden and requests never send `reasoning_effort` even when the deployed model is `gpt-5` or `o3-mini`.

## Goal

When managing Azure deployments, collect **deployment name** and **underlying model name**. Let users confirm **Supports reasoning effort** (default on when the model heuristic matches; user can turn off). When supported and enabled, show the chat Effort control and send `reasoning_effort` on Azure chat completions; assistant message metadata continues to show sent effort when the API includes it.

## Decisions

| Topic | Choice |
| --- | --- |
| Checkbox meaning | **Supports reasoning effort** (option A): defaults from `openAiModelUsesReasoningEffort(model)`; user can disable |
| Chat selection key | Deployment **name** only (unchanged) |
| Model field | Required on **new** deployment adds; stored per deployment |
| OpenAI (non-Azure) | Unchanged |
| Vision / other tags | Out of scope; may later use `model` when set |
| Catalog | Remains deployments-only (no Azure model catalog UI) |

## Effective reasoning

For deployment entry `d`:

```
supportsReasoning(d) =
  d.reasoningEffortEnabled &&
  d.model.trim() !== '' &&
  openAiModelUsesReasoningEffort(d.model)
```

Chat Effort picker and Azure `buildChatBody` use `supportsReasoning(d)` and `d.model` for `resolveReasoningEffortForRequest`, not `d.name`.

## Data model

Extend `AzureOpenaiDeploymentEntry` in `src/shared/types.ts`:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Azure deployment name |
| `enabled` | boolean | Appears in chat when true |
| `model` | string | Base model id (e.g. `gpt-5`, `o3-mini`) |
| `reasoningEffortEnabled` | boolean | User toggle; default true when heuristic matches on add |

**Migration:** Existing deployments normalize to `model: ''`, `reasoningEffortEnabled: false`. Update `normalizeAzureDeployment` in `src/main/config-store.ts` to persist all four fields (stop stripping `model` / checkbox).

**Add defaults:** On new deployment, if `reasoningEffortEnabled` omitted, set to `openAiModelUsesReasoningEffort(model.trim())`.

## Architecture

```
Models Azure tab
  add / edit deployment (name, model, checkbox)
        │
        ▼
config-store azureOpenaiDeployments[]
        │
        ├─► Renderer: selected deployment → supportsReasoning → Chat Effort picker
        │
        └─► Main: azure-openai-client buildChatBody
              model = deployment.model
              reasoning_effort only if supportsReasoning(deployment)
```

Shared helper (recommended): e.g. `src/shared/azure-deployment.ts` with `supportsAzureDeploymentReasoning(entry)` and reuse in renderer + main to avoid drift.

## UI — Models → Azure OpenAI

**Add form**

- Inputs: **Deployment name**, **Model name** (placeholder `gpt-5`, `o3-mini`).
- Checkbox: **Supports reasoning effort** — on add, when model text changes, set checkbox to `openAiModelUsesReasoningEffort(model)` until user manually toggles (implementation: track “user touched checkbox” on add form, or re-sync only on first model entry).
- Submit blocked if deployment name or model name empty.
- Duplicate deployment name: existing error behavior.

**Deployment list**

- Primary: deployment name; secondary: `Model: {model}` or `—` if legacy empty.
- Checkbox **Supports reasoning effort** per row → `updateAzureOpenaiDeployment(name, { reasoningEffortEnabled })`.
- Editable **model** field per row (blur/change → `updateAzureOpenaiDeployment`); when model changes, set checkbox to heuristic unless user has explicitly toggled checkbox on that row (same pattern as add form).

## Chat & API

**Composer:** Extend `shouldShowReasoningEffortControl` (or parallel Azure path in `Chat`/`App`) so for `effectiveProvider === 'azure-openai'`, resolve selected deployment from `azureOpenaiDeployments` and use `supportsReasoning(deployment)`.

**Azure HTTP:** In `buildChatBody`, load deployment by `options.deployment` name from config; pass `deployment.model` into `resolveReasoningEffortForRequest` only when `supportsReasoning(deployment)`; otherwise omit `reasoning_effort`.

**Message meta:** No schema change; existing `reasoningEffort` on assistant messages when `reasoningEffortSent` is set.

## IPC & preload

- `azureOpenai:addDeployment` accepts `AzureOpenaiDeploymentEntry` or `{ name, model, reasoningEffortEnabled?, enabled? }` (deprecate string-only add in types; keep backward compat in main: string → `{ name, model: '', reasoningEffortEnabled: false }`).
- `updateAzureOpenaiDeployment` patch includes `model` and `reasoningEffortEnabled`.
- Renderer props: `onAddAzureDeployment` signature updated to pass object.

## Error handling

- Chat with legacy deployment (`model` empty): no Effort picker; no `reasoning_effort` sent (same as today).
- Checkbox on with non-reasoning model id: `supportsReasoning` is false (heuristic and checkbox both required).

## Testing

**Unit**

- `normalizeAzureDeployment` retains `model` and `reasoningEffortEnabled`.
- `supportsAzureDeploymentReasoning` true/false cases.
- Azure `buildChatBody` uses model id; omits effort when checkbox off or model non-reasoning.
- Chat gating helper true when Azure deployment selected and `supportsReasoning`.

**Manual**

1. Add deployment `test-deploy` + model `gpt-5`, checkbox on → Effort visible in chat.
2. Disable checkbox → picker hidden; new messages lack effort meta.
3. Legacy deployment without model → no picker.
4. Tool turn still forces `none` effort when effort is sent (existing behavior).

## Non-goals

- Azure model catalog restoration
- Per-deployment effort level (still global chat preference)
- Automatic deployment discovery from Azure API

## Success criteria

- Users enter model name alongside deployment name.
- Reasoning-capable Azure deployments show Effort in chat when checkbox enabled and model matches heuristic.
- Azure API receives `reasoning_effort` based on **model** field, not deployment alias.
- Assistant metadata shows sent effort when applicable (existing UX).
