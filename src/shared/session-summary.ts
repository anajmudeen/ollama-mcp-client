import type { ChatSession, SessionSummary, SessionsListState, SessionsState } from './types'

export function toSessionSummary(session: ChatSession): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    origin: session.origin
  }
}

export function toSessionsListState(state: SessionsState): SessionsListState {
  return {
    sessions: state.sessions.map(toSessionSummary),
    activeSessionId: state.activeSessionId,
    telegramActiveSessionId: state.telegramActiveSessionId
  }
}
