# Telegram / desktop session split

Date: 2026-09-06

## Problem

Telegram and the desktop app share one session list and one active session. A Telegram `/new` or `/switch` changes the desktop UI, and desktop sessions appear in Telegram. Users want independent session namespaces.

## Goal

| Origin | Desktop sidebar | Telegram `/sessions` | Send from desktop |
| --- | --- | --- | --- |
| Telegram | Yes (📱 badge), read-only | Yes | No |
| Desktop | Yes | No | Yes |

- Mixed sidebar sorted by activity; 📱 badge on telegram sessions.
- Separate active session IDs: `activeSessionId` (desktop UI) and `telegramActiveSessionId` (bot).
- Telegram mirror only for turns started from Telegram.

## Non-goals

- Replying to telegram sessions from desktop
- Moving sessions between origins
- Per-user telegram session lists (still shared among allowed users)
- Group chats

## Data model

```ts
type SessionOrigin = 'desktop' | 'telegram'

ChatSession {
  ...
  origin: SessionOrigin  // existing sessions default to 'desktop'
}

SessionsState {
  sessions: ChatSession[]
  activeSessionId: string | null
  telegramActiveSessionId: string | null
}
```

## Telegram behavior

- `/new` → create `origin: 'telegram'`, set `telegramActiveSessionId`
- `/sessions`, `/switch`, `/delete`, `/current` → telegram sessions only
- Plain text → `ensureTelegramActiveSession()`, append to telegram active session
- Mirror → only turns registered via `beginTelegramActivity`

## Desktop behavior

- Sidebar shows all sessions; 📱 on `origin: 'telegram'`
- Select telegram session → read-only chat, banner, composer disabled
- New chat → `origin: 'desktop'`
- Delete hidden for telegram sessions (manage via Telegram)
- `ensureActiveSession` ensures at least one desktop session exists without stealing telegram view focus

## Manual test

1. `/new` on Telegram → appears in desktop sidebar with 📱; composer disabled when selected.
2. Send from Telegram → reply on Telegram; desktop history updates read-only.
3. New chat on desktop → not in Telegram `/sessions`.
4. Send from desktop → normal; Telegram unaffected.
5. Telegram `/switch` does not change desktop active session.
