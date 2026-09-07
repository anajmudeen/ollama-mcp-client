# Telegram live status line

Date: 2026-09-06

## Problem

After a Telegram user sends a message, the status line stays on `⏳ Processing your message…` and does not update to show model thinking, tool calls (with tool name), or writing progress — even when the user expects live activity feedback.

## Goal

When **Show live status on Telegram** is enabled (`telegramMirrorMode: 'full'`), show **one status message** edited in place as the agent works:

- Thinking / reasoning
- Tool calls with **full prefixed** tool names (`filesystem__list`)
- Writing reply
- Then `✓ Done` + final Markdown reply

When the toggle is off (`final`), keep only `⏳ Processing…` until the final reply.

## Non-goals

- Multiple status messages (timeline)
- Streaming thinking text to Telegram
- Tool argument JSON on Telegram
- Desktop UI changes

## Approach

Harden the existing `telegram-mirror.ts` path: fix race between `beginTelegramActivity` and agent events, use full tool names in formatters, map all relevant `chat:event` types to status text, improve Settings copy.

## Behavior

### Settings: Show live status ON (`full`)

| Step | Status line text |
| --- | --- |
| Message received | `⏳ Processing your message…` |
| Model reasoning | `💭 Model is reasoning…` (from agent `status` or `💭 Thinking…`) |
| Tool start | `🔧 Calling filesystem__list…` (full `event.name`) |
| Tool done | `✅ filesystem__list` or `❌ filesystem__list failed` |
| Reply streaming | `✍️ Writing reply…` |
| Complete | Edit to `✓ Done`, send final reply (HTML Markdown) |

### Settings: Show live status OFF (`final`)

| Step | Status line text |
| --- | --- |
| Message received | `⏳ Processing your message…` |
| During turn | No updates |
| Complete | `✓ Done` + final reply |

## Implementation notes

1. **`beginTelegramActivity` must complete** before `runAgentTurn` starts (await) to avoid duplicate status messages and missed edits.
2. **Tool formatters** use full `server__tool` name, not `shortToolLabel`.
3. **Same `turnId`** — do not clear `mirrorByUser` when `resetForTurn` sees the same turn as `beginTelegramActivity`.
4. **Log** Telegram API errors on status edit (except `message is not modified`).
5. **Settings label** clarifies that the toggle controls live thinking/tool/writing updates.

## Manual test plan

1. Enable **Show live status on Telegram** in Settings.
2. Send a message from Telegram that triggers tool use.
3. Verify status line updates: Processing → Thinking → Calling `server__tool` → Done → final reply.
4. Disable toggle; verify only Processing until final reply.
5. Send from desktop with Telegram connected; verify same status updates for allowed users.
