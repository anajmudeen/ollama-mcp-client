# Reasoning effort for OpenAI and Azure OpenAI

Date: 2026-09-29

## Problem

OpenAI and Azure reasoning models accept `reasoning_effort` on Chat Completions (`none` | `low` | `medium` | `high`). Today the app only sets `reasoning_effort: 'none'` when tools are attached (API requirement on chat/completions for many GPT‑5.x models). There is no user control; tool-free turns rely on the provider default.

Migrating to the Responses API would allow non-`none` effort with tools, but is a large rewrite. This design stays on Chat Completions and adds a small in-chat control.

## Goal

Let the user pick reasoning effort while chatting (default **low**) for OpenAI and Azure reasoning models. Persist the preference. Keep tool turns safe by forcing `none` when tools are present.

## Decisions

| Topic | Choice |
| --- | --- |
| API surface | Stay on Chat Completions (no Responses migration) |
| Values | `none` \| `low` \| `medium` \| `high` |
| Default | `low` |
| Scope | One global preference for OpenAI + Azure |
| UI location | In-chat, near model picker |
| Visibility | OpenAI/Azure + model matches `openAiModelUsesReasoningEffort` |
| Tools present | Request override to `none` (UI preference unchanged) |
| Ollama | Unchanged; control hidden |
| Persistence | App config (like `showThinking`) |

## Architecture

```
Chat Effort control ──► config.reasoningEffort (default low)
                              │
                              ▼
              OpenAI / Azure chat body builder
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
   non-reasoning          tools present      no tools + reasoning
   omit field             force 'none'       send user preference
```

1. Config stores `reasoningEffort` with default `low`; IPC get/set for the renderer.
2. Chat shows a compact effort control when the effective provider is OpenAI or Azure and the selected model/deployment is reasoning-capable (`openAiModelUsesReasoningEffort`).
3. `openAiChatStream` / Azure `buildChatBody` apply the rules above. Existing “tools ⇒ none” behavior becomes “tools ⇒ none, else user preference (if reasoning model)”.
4. Agent / Ollama paths unchanged.

## UI

- Control label along the lines of **Effort** with options None / Low / Medium / High.
- Place in composer chrome beside the model picker.
- Changing the value updates persisted config immediately; applies to the next send (not mid-stream).
- Optional short hint when tools will force `none` for the request; no modal.
- Hidden for Ollama and for models that reject `reasoning_effort` (e.g. GPT‑4o).

## Data and IPC

- `AppConfig.reasoningEffort: ReasoningEffort` where `ReasoningEffort = 'none' | 'low' | 'medium' | 'high'`.
- Default in store: `'low'`.
- Invalid/missing stored values coerce to `'low'`.
- Expose set via existing config IPC pattern (`config:setReasoningEffort` or equivalent).

## Client request rules

For OpenAI model id or Azure deployment name `m`:

1. If `!openAiModelUsesReasoningEffort(m)` → omit `reasoning_effort`.
2. Else if `tools.length > 0` → `reasoning_effort: 'none'`.
3. Else → `reasoning_effort: <user preference>`.

Do not send the field for Ollama.

## Error handling

- Avoid the known Chat Completions 400 for tools + non-`none` effort by rule (2).
- Other API errors continue through the existing chat error path.
- Non-reasoning models must not receive the parameter (rule 1).

## Testing

- Config default is `low`; set/get round-trips; invalid values coerce to `low`.
- OpenAI/Azure body builders: omit for non-reasoning; user value without tools; `none` with tools.
- Control visibility rules covered by a small pure helper if useful.
- `npm run typecheck`.

## Out of scope

- Responses API migration
- Per-provider or per-session effort
- Ollama thinking / num_predict knobs
- Changing `showThinking` behavior
- Built-in OpenAI Responses tools (web search, etc.)

## Success criteria

- User can change effort in chat; preference persists across restarts; default is low.
- Tool-free reasoning turns send the chosen effort.
- Tool turns on reasoning models send `none` and do not 400 for effort+tools.
- Non-reasoning models and Ollama are unaffected.
