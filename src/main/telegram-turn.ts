import { randomUUID } from 'crypto'
import type { ChatMessage, UiMessage } from '../shared/types'
import { enqueueTurn } from './chat-queue'
import {
  ensureTelegramActiveSession,
  getSelectedModel,
  getTelegramActiveSessionId,
  updateSession
} from './config-store'
import { broadcastSessionsChanged } from './sessions-broadcast'
import { beginTelegramActivity } from './telegram-mirror'

function nowIso(): string {
  return new Date().toISOString()
}

export async function runTelegramTurn(
  userText: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = userText.trim()
  if (!trimmed) return { ok: false, error: 'Message is empty.' }

  const model = getSelectedModel()
  if (!model) {
    return { ok: false, error: 'Select a model in the desktop app first.' }
  }

  const state = ensureTelegramActiveSession()
  const sessionId = getTelegramActiveSessionId() ?? state.telegramActiveSessionId
  if (!sessionId) return { ok: false, error: 'No active Telegram session.' }

  const session = state.sessions.find((s) => s.id === sessionId)
  if (!session) return { ok: false, error: 'Active Telegram session not found.' }
  if ((session.origin ?? 'desktop') !== 'telegram') {
    return { ok: false, error: 'Active session is not a Telegram session.' }
  }

  const turnId = randomUUID()
  const userHistory: ChatMessage = { role: 'user', content: trimmed }
  const userUi: UiMessage = {
    kind: 'user',
    id: randomUUID(),
    content: trimmed,
    createdAt: nowIso(),
    model
  }

  const nextHistory = [...session.history, userHistory]
  const nextUi = [...session.uiMessages, userUi]

  let title = session.title
  if (title === 'New chat') {
    title = trimmed.length > 48 ? `${trimmed.slice(0, 45)}…` : trimmed
  }

  updateSession(sessionId, {
    title,
    history: nextHistory,
    uiMessages: nextUi
  })
  broadcastSessionsChanged()

  await beginTelegramActivity(turnId, '⏳ Processing your message…')

  const enqueued = await enqueueTurn({
    model,
    messages: nextHistory,
    turnId,
    sessionId
  })
  if (!enqueued.ok) {
    return { ok: false, error: enqueued.error }
  }

  return { ok: true }
}
