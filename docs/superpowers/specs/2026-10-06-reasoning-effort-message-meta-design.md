# Reasoning effort in assistant message metadata

Date: 2026-10-06

## Problem

Users can set reasoning effort in chat (`none` | `low` | `medium` | `high`), and the token tooltip can show **reasoning tokens** when the API reports them. Assistant `MessageMeta` still does not show which **`reasoning_effort` was actually sent** on the request. That matters because tool turns force `none` while the picker may still show `low` / `medium` / `high`, and multi-call turns can end on a different effort than earlier calls.

## Goal

Show the **effective `reasoning_effort` from the last model call** in the assistant reply metadata row (`MessageMeta`), inline only when the provider sent the parameter. Persist it on the assistant `UiMessage` like `model` and `tokenUsage`.

## Decisions (brainstorming)

| Topic | Choice |
| --- | --- |
| Value shown | What was **sent on the API**, not the chat picker alone |
| Multi-call turns | **Last** `chatStream` in the turn |
| Placement | **Inline** in `MessageMeta` (dot-separated segment) |
| Label | Raw value: `none` \| `low` \| `medium` \| `high`; `title="Reasoning effort"` |
| When omitted | Model does not support `reasoning_effort` (Ollama, GPT‑4o, etc.) — field absent, not `none` |
| Per-call breakdown | Out of scope (no tooltip list) |

## Architecture

```
OpenAI / Azure buildChatBody (existing resolveReasoningEffortForRequest)
        │
        ▼
LlmChatStreamResult.reasoningEffortSent?: ReasoningEffort
        │
        ▼
agent: after each llm.chatStream, lastReasoningEffort = result.reasoningEffortSent ?? lastReasoningEffort
        │
        ▼
assistant_done.reasoningEffort?: ReasoningEffort  →  UiMessage  →  MessageMeta
```

**Recommended implementation path:** attach `reasoningEffortSent` on the stream result inside OpenAI/Azure clients when `reasoning_effort` is included on the request body (same place effort is resolved today). The agent does not re-derive effort separately.

Ollama `chatStream` never sets the field.

## Data model

Extend in `src/shared/types.ts`:

- `ChatEvent` variant `assistant_done` with optional `reasoningEffort?: ReasoningEffort`
- `UiMessage` assistant branch with optional `reasoningEffort?: ReasoningEffort`

Extend `LlmChatStreamResult` in `src/main/llm/types.ts`:

- optional `reasoningEffortSent?: ReasoningEffort`

Propagate from `OpenAiStreamResult` (and Azure wrapper) when the HTTP body includes `reasoning_effort`.

## Agent behavior

At turn start, `lastReasoningEffort` is undefined.

After each successful `llm.chatStream` in the tool loop and on wrap-up:

- If `streamResult.reasoningEffortSent` is defined, set `lastReasoningEffort` to that value.

On `assistant_done`, include `reasoningEffort: lastReasoningEffort` only when defined.

Image-only turns, `chatOnce` (title, compact, etc.), and paths that do not use chat completions for the visible reply are unchanged.

## UI

`MessageMeta`:

- New prop `reasoningEffort?: ReasoningEffort`
- When set, render a segment with the raw string and `title="Reasoning effort"`, styled like other muted meta (`duration`, `tokens/sec`).
- Position: after model/time segments, consistent with existing dot separators.

Wire through:

- `Chat.tsx` → `MessageMeta`
- `App.tsx` `assistant_done` handler
- `backgroundChatEvents.ts` (same fields as `tokenUsage` / `multiCallTurn`)

Session persistence: store on assistant `uiMessages` when the reply finishes.

## Non-goals

- Showing the chat effort picker value when it differs from what was sent
- Per-call effort in the context/token tooltip
- Telegram-specific UI
- Responses API migration

## Testing

- `MessageMeta`: renders `low` (etc.) when `reasoningEffort` is set; omits segment when undefined
- Typecheck (`npm run typecheck`)
- Optional: provider or agent test that a tool iteration sets `none` and a following no-tools call updates to user effort on the stream result

## Success criteria

- Reasoning-capable OpenAI/Azure replies show the last-call effort inline (`none` included when that was sent)
- Ollama and non-reasoning models show no effort segment
- Reloading a session still shows effort on historical assistant messages
- Background / queued session event handling matches the active chat path
