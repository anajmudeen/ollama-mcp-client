# Configurable max tool iterations

Date: 2026-09-06

## Problem

Users hit `Stopped after 8 tool iterations` during complex multi-tool tasks. The limit is hardcoded and too low for many workflows.

## Goal

Make the per-turn tool-call round limit configurable:

| Setting | Value |
| --- | --- |
| Default | 30 |
| Minimum | 8 |
| Maximum | 100 |
| Scope | Global (desktop, Telegram, schedules) |

When the limit is reached, run one **bonus** text-only model turn (no tools) so the agent summarizes progress instead of showing an error.

## Config

```ts
// AppConfig
maxToolIterations: number // default 30, clamped 8–100 on read/write
```

- Persisted in `electron-store` via `config-store.ts`
- IPC: `config:setMaxToolIterations(n)` + included in `config:get`
- Preload: `window.api.setMaxToolIterations(n)`

## Agent behavior

1. Read `maxToolIterations` at turn start (replace `MAX_TOOL_ITERATIONS = 8`).
2. Loop allows up to **N** iterations where the model may call tools.
3. If iteration **N** ends with tool calls executed and the budget is exhausted:
   - Append a user message instructing a summary without further tools.
   - Run one bonus `chatStream` with `tools: undefined`.
   - Complete via `assistant_done` (not `error`).
   - If the model still returns tool calls, ignore them; use streamed text only.
4. Remove the `Stopped after N tool iterations` error path for limit exhaustion.

Wrap-up prompt (fixed):

> You've reached the maximum number of tool calls for this turn. Summarize what you accomplished, what's incomplete, and suggest next steps. Do not call any more tools.

## Settings UI

Under **Chat** in Settings:

- **Max tool iterations** — number input, min 8, max 100
- Helper: *How many tool-call rounds the agent can run per message. A final summary is added if the limit is reached.*

Clamp invalid values on save.

## Edge cases

- Abort during wrap-up: same as existing abort handling.
- No MCP tools registered: unchanged (single reply turn).
- Existing installs without the key: default to 30.

## Non-goals

- Per-session or per-context limits
- Dynamic scaling by context window size

## Manual test

1. Default 30 — complex tool task completes or wraps up with summary.
2. Set to 8 — hits limit sooner, still gets summary not error.
3. Set 7 → clamps to 8; set 150 → clamps to 100.
4. Telegram and schedule turns respect the same setting.
