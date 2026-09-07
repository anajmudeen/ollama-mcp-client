# Telegram tool status display

Date: 2026-09-06

## Problem

Telegram live status shows MCP tools with UUID-prefixed names, e.g.
`cfbb4dd8-ea0a-48af-8d9a-244ff994b368__read_text_file`, which is hard to read.
The desktop agent already shows short tool names in status detail.

## Goal

Show **friendly server name + tool name** on Telegram tool status lines:

- `🔧 Calling MCP Filesystem Downloads folder · read_text_file…`
- `✅ MacBook Monitor · get_metrics`
- `❌ MCP Filesystem Downloads folder · read_text_file failed`

## Non-goals

- Tool argument JSON on Telegram
- Desktop UI changes
- Renaming MCP server IDs in the model/tool registry

## Approach

Resolve display labels at format time via `mcpManager` lookup on `prefixedName`.
Keep formatters in `telegram-format.ts`; no shared `ChatEvent` type changes.

## Name resolution

1. Look up `prefixedName` in `mcpManager.listAllTools()`.
2. If found → `{ serverName: config.name, toolName: tool.name }`.
3. If not found (e.g. `load_skill`, disconnected server) → tool name only via `shortToolLabel(prefixedName)`.

Display template: `{serverName} · {toolName}` when server is known; otherwise `{toolName}` alone.

## Components

| File | Change |
| --- | --- |
| `mcp-manager.ts` | `resolveToolDisplay(prefixedName)` |
| `telegram-format.ts` | `formatTelegramToolDisplayLabel`, update tool start/done formatters |
| `telegram-mirror.ts` | No logic change (uses updated formatters) |

## Manual test

1. Send a Telegram message that triggers an MCP tool call.
2. Verify status shows friendly server + tool, not UUID prefix.
3. Verify success/failure lines use the same label format.
