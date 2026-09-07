# Telegram schedules

Date: 2026-09-06

## Problem

Users want recurring agent runs without manually messaging the Telegram bot each time — e.g. hourly summaries or daily checks.

## Goal

A **Schedules** page (alongside Models, MCP, Skills) to define tasks that run the agent on an interval or cron expression and deliver results via:

| Delivery mode | Where result goes |
| --- | --- |
| `telegram` | Telegram reply (📱 session) |
| `notification` | Desktop only — system toast or in-app banner |
| `both` | Telegram + notification (user picks system vs in-app for notification half) |

Telegram `/schedule` commands: list, run now, pause, resume. Create/edit/delete on desktop only.

## Constraints

- Runs only while the desktop app is open (same as Telegram bot).
- Minimum interval: 1 minute.
- Skip tick if an agent turn is already in progress (`skipped` status).
- Requires selected model; Telegram modes require bot enabled + token.

## Data model

```ts
type ScheduleRecurrence =
  | { type: 'interval'; everyMinutes: number }
  | { type: 'cron'; expression: string; timezone?: string }

type ScheduleDelivery =
  | { mode: 'telegram' }
  | { mode: 'notification'; channel: 'system' | 'in-app' }
  | { mode: 'both'; notificationChannel: 'system' | 'in-app' }

interface TelegramSchedule {
  id: string
  name: string
  prompt: string
  enabled: boolean
  recurrence: ScheduleRecurrence
  delivery: ScheduleDelivery
  /** Telegram session when delivery includes telegram; desktop session for notification-only */
  sessionId: string | null
  createdAt: string
  updatedAt: string
  lastRunAt?: string
  lastRunStatus?: 'ok' | 'error' | 'skipped'
  lastRunError?: string
}
```

## Components

| Module | Responsibility |
| --- | --- |
| `schedule-runner.ts` | Register interval + cron jobs; reload on config change |
| `schedule-executor.ts` | Run one task: session append → `runAgentTurn` → wait for `assistant_done` → deliver |
| `schedule-notify.ts` | System `Notification` + IPC to renderer for in-app toast |
| `SchedulesPage.tsx` | CRUD UI |
| `telegram-bot.ts` | `/schedule` commands |
| `config-store.ts` | Persist `schedules[]` |

## Run flow

1. Tick → guards (enabled, model, telegram if needed, not busy).
2. Append user prompt to target session; `runAgentTurn` with `sessionId` + `turnId`.
3. Telegram delivery: `beginTelegramActivity` + mirror (existing path).
4. On `assistant_done`: update session; if notification → snippet (200 chars); update `lastRunAt`.

## Non-goals

- Running when app is quit
- Email/SMS/webhooks
- Group Telegram chats
- Telegram-side create/edit forms

## Manual test

1. Create interval schedule (2 min), telegram delivery → reply on Telegram.
2. Notification-only → system toast with snippet.
3. Both → Telegram + toast.
4. `/schedule pause 1` stops ticks; `/schedule run 1` runs immediately.
5. Agent busy → `skipped` on Schedules page.
