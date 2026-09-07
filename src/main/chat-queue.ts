import { BrowserWindow } from 'electron'
import type { ChatQueueState, ChatSendPayload, SessionQueueStatus } from '../shared/types'
import { abortChat, runAgentTurn } from './agent'

let running: ChatSendPayload | null = null
const fifo: ChatSendPayload[] = []

function broadcast(): void {
  const state = getQueueState()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('queue:changed', state)
  }
}

export function getQueueState(): ChatQueueState {
  return {
    running: running
      ? { sessionId: running.sessionId, turnId: running.turnId }
      : null,
    queued: fifo.map((p) => ({ sessionId: p.sessionId, turnId: p.turnId }))
  }
}

function sessionHasPending(sessionId: string): boolean {
  if (running?.sessionId === sessionId) return true
  return fifo.some((p) => p.sessionId === sessionId)
}

async function runOne(payload: ChatSendPayload): Promise<void> {
  running = payload
  broadcast()
  try {
    await runAgentTurn(payload)
  } finally {
    running = null
    broadcast()
    const next = fifo.shift()
    if (next) {
      await runOne(next)
    }
  }
}

export async function enqueueTurn(
  payload: ChatSendPayload
): Promise<{ ok: true; queued: boolean } | { ok: false; error: string }> {
  if (sessionHasPending(payload.sessionId)) {
    return { ok: false, error: 'Session already has a pending turn.' }
  }

  const queued = running !== null
  if (!running) {
    void runOne(payload)
  } else {
    fifo.push(payload)
    broadcast()
  }
  return { ok: true, queued }
}

export function abortCurrentTurn(): void {
  abortChat()
}

export function removeSessionTurns(sessionId: string): void {
  const idx = fifo.findIndex((p) => p.sessionId === sessionId)
  if (idx >= 0) {
    fifo.splice(idx, 1)
    broadcast()
  }
  if (running?.sessionId === sessionId) {
    abortChat()
  }
}

export function getSessionQueueStatus(sessionId: string): SessionQueueStatus {
  if (running?.sessionId === sessionId) return 'running'
  if (fifo.some((p) => p.sessionId === sessionId)) return 'queued'
  return 'idle'
}
