import { randomUUID } from 'crypto'
import type { ChatEvent, TelegramSchedule } from '../shared/types'
import { isAgentBusy } from './agent'
import { enqueueTurn } from './chat-queue'
import { onChatEvent } from './chat-events'
import {
  ensureTelegramActiveSession,
  getSchedule,
  getSelectedModel,
  getSessionsState,
  getTelegramActiveSessionId,
  getTelegramBotToken,
  getTelegramEnabled,
  patchScheduleRun,
  updateSession
} from './config-store'
import {
  broadcastInAppScheduleNotification,
  sendSystemScheduleNotification,
  snippetForNotification
} from './schedule-notify'
import { broadcastSchedulesChanged } from './schedules-broadcast'
import { broadcastSessionsChanged } from './sessions-broadcast'
import { beginTelegramActivity } from './telegram-mirror'

function nowIso(): string {
  return new Date().toISOString()
}

function deliveryUsesTelegram(delivery: TelegramSchedule['delivery']): boolean {
  return delivery.mode === 'telegram' || delivery.mode === 'both'
}

function notificationChannel(
  delivery: TelegramSchedule['delivery']
): 'system' | 'in-app' | null {
  if (delivery.mode === 'notification') return delivery.channel
  if (delivery.mode === 'both') return delivery.notificationChannel
  return null
}

function waitForTurnResult(
  turnId: string
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const unsub = onChatEvent((event: ChatEvent) => {
      if (event.turnId !== turnId) return
      if (event.type === 'assistant_done') {
        unsub()
        resolve({ ok: true, content: event.content ?? '' })
      } else if (event.type === 'assistant_images') {
        unsub()
        resolve({ ok: true, content: '[generated image]' })
      } else if (event.type === 'error') {
        unsub()
        resolve({ ok: false, error: event.message })
      }
    })
  })
}

function resolveSessionId(schedule: TelegramSchedule): string | null {
  if (schedule.sessionId) {
    const exists = getSessionsState().sessions.some((s) => s.id === schedule.sessionId)
    if (exists) return schedule.sessionId
  }
  if (deliveryUsesTelegram(schedule.delivery)) {
    const state = ensureTelegramActiveSession()
    return getTelegramActiveSessionId() ?? state.telegramActiveSessionId
  }
  return null
}

export async function executeSchedule(
  scheduleId: string,
  options?: { manual?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const schedule = getSchedule(scheduleId)
  if (!schedule) return { ok: false, error: 'Schedule not found.' }
  if (!schedule.enabled && !options?.manual) {
    return { ok: false, error: 'Schedule is disabled.' }
  }

  const model = getSelectedModel()
  if (!model) {
    patchScheduleRun(scheduleId, {
      lastRunAt: nowIso(),
      lastRunStatus: 'error',
      lastRunError: 'No model selected in the desktop app.'
    })
    broadcastSchedulesChanged()
    return { ok: false, error: 'No model selected.' }
  }

  if (deliveryUsesTelegram(schedule.delivery)) {
    if (!getTelegramEnabled() || !getTelegramBotToken()) {
      patchScheduleRun(scheduleId, {
        lastRunAt: nowIso(),
        lastRunStatus: 'error',
        lastRunError: 'Telegram bot is not enabled or configured.'
      })
      broadcastSchedulesChanged()
      return { ok: false, error: 'Telegram not configured.' }
    }
  }

  if (isAgentBusy()) {
    patchScheduleRun(scheduleId, {
      lastRunAt: nowIso(),
      lastRunStatus: 'skipped',
      lastRunError: 'Agent is busy with another turn.'
    })
    broadcastSchedulesChanged()
    return { ok: false, error: 'Agent busy.' }
  }

  const sessionId = resolveSessionId(schedule)
  if (!sessionId) {
    patchScheduleRun(scheduleId, {
      lastRunAt: nowIso(),
      lastRunStatus: 'error',
      lastRunError: 'No target session available.'
    })
    broadcastSchedulesChanged()
    return { ok: false, error: 'No session.' }
  }

  const session = getSessionsState().sessions.find((s) => s.id === sessionId)
  if (!session) {
    patchScheduleRun(scheduleId, {
      lastRunAt: nowIso(),
      lastRunStatus: 'error',
      lastRunError: 'Target session not found.'
    })
    broadcastSchedulesChanged()
    return { ok: false, error: 'Session not found.' }
  }

  const prompt = schedule.prompt.trim()
  if (!prompt) {
    patchScheduleRun(scheduleId, {
      lastRunAt: nowIso(),
      lastRunStatus: 'error',
      lastRunError: 'Prompt is empty.'
    })
    broadcastSchedulesChanged()
    return { ok: false, error: 'Empty prompt.' }
  }

  const turnId = randomUUID()
  const userHistory = { role: 'user' as const, content: prompt }
  const userUi = {
    kind: 'user' as const,
    id: randomUUID(),
    content: prompt,
    createdAt: nowIso(),
    model
  }

  const nextHistory = [...session.history, userHistory]
  const nextUi = [...session.uiMessages, userUi]
  let title = session.title
  if (title === 'New chat') {
    title = schedule.name.length > 48 ? `${schedule.name.slice(0, 45)}…` : schedule.name
  }

  updateSession(sessionId, {
    title,
    history: nextHistory,
    uiMessages: nextUi
  })
  broadcastSessionsChanged()

  if (deliveryUsesTelegram(schedule.delivery)) {
    await beginTelegramActivity(turnId, `⏳ Scheduled: ${schedule.name}…`)
  }

  const enqueued = await enqueueTurn({
    model,
    messages: nextHistory,
    turnId,
    sessionId
  })
  if (!enqueued.ok) {
    patchScheduleRun(scheduleId, {
      lastRunAt: nowIso(),
      lastRunStatus: 'error',
      lastRunError: enqueued.error
    })
    broadcastSchedulesChanged()
    return { ok: false, error: enqueued.error }
  }

  const result = await waitForTurnResult(turnId)

  const channel = notificationChannel(schedule.delivery)
  if (channel && result.ok && result.content) {
    const snippet = snippetForNotification(result.content)
    if (channel === 'system') {
      sendSystemScheduleNotification(schedule.name, snippet)
    } else {
      broadcastInAppScheduleNotification({
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        snippet,
        sessionId
      })
    }
  }

  if (result.ok) {
    patchScheduleRun(scheduleId, {
      lastRunAt: nowIso(),
      lastRunStatus: 'ok',
      lastRunError: undefined
    })
    broadcastSchedulesChanged()
    return { ok: true }
  }

  patchScheduleRun(scheduleId, {
    lastRunAt: nowIso(),
    lastRunStatus: 'error',
    lastRunError: result.error
  })
  broadcastSchedulesChanged()
  return { ok: false, error: result.error }
}
