import type { ChatEvent } from '../shared/types'
import { onChatEvent } from './chat-events'
import {
  getTelegramAllowedUserIds,
  getTelegramMirrorMode
} from './config-store'
import {
  formatTelegramActivityDone,
  formatTelegramActivityFromStatus,
  formatTelegramActivityToolDone,
  formatTelegramActivityToolStart,
  formatTelegramActivityWriting
} from './telegram-format'

export interface TelegramSendFns {
  sendText: (userId: number, text: string) => Promise<void>
  /** Assistant replies: Markdown → Telegram HTML. */
  sendMarkdownChunks: (userId: number, markdown: string) => Promise<void>
  sendStreamMessage: (userId: number, text: string) => Promise<number>
  editText: (userId: number, messageId: number, text: string) => Promise<void>
  sendPhoto: (userId: number, base64: string, caption?: string) => Promise<void>
  sendTyping: (userId: number) => Promise<void>
}

type UserMirrorState = {
  statusMessageId: number | null
}

const mirrorByUser = new Map<number, UserMirrorState>()
let sendFns: TelegramSendFns | null = null
let activeTurnId: string | null = null
let eventChain: Promise<void> = Promise.resolve()

function emptyState(): UserMirrorState {
  return { statusMessageId: null }
}

function userState(userId: number): UserMirrorState {
  let state = mirrorByUser.get(userId)
  if (!state) {
    state = emptyState()
    mirrorByUser.set(userId, state)
  }
  return state
}

export function resetTelegramMirrorState(): void {
  mirrorByUser.clear()
  activeTurnId = null
}

/** Immediate feedback when a Telegram user sends a message (before the agent emits events). */
export function beginTelegramActivity(turnId: string, text: string): void {
  if (!sendFns) return
  activeTurnId = turnId
  mirrorByUser.clear()
  void forEachAllowed(async (userId) => {
    await sendFns!.sendTyping(userId)
    await setActivityStatus(userId, text)
  }).catch((err) => {
    console.error('[telegram-mirror] begin activity error', err)
  })
}

function resetForTurn(turnId: string | undefined): void {
  if (!turnId || turnId === activeTurnId) return
  activeTurnId = turnId
  mirrorByUser.clear()
}

async function forEachAllowed(
  fn: (userId: number) => Promise<void>
): Promise<void> {
  for (const userId of getTelegramAllowedUserIds()) {
    await fn(userId)
  }
}

async function setActivityStatus(userId: number, text: string): Promise<void> {
  if (!sendFns || !text) return
  const state = userState(userId)
  if (state.statusMessageId == null) {
    state.statusMessageId = await sendFns.sendStreamMessage(userId, text)
  } else {
    await sendFns.editText(userId, state.statusMessageId, text)
  }
}

async function handleEvent(event: ChatEvent): Promise<void> {
  if (!sendFns) return

  if (event.turnId) resetForTurn(event.turnId)

  if (event.type === 'error') {
    await forEachAllowed((userId) =>
      sendFns!.sendText(userId, `⚠️ ${event.message}`)
    )
    return
  }

  const mode = getTelegramMirrorMode()

  if (mode === 'final') {
    if (event.type === 'assistant_done') {
      const finalText = event.content ?? ''
      await forEachAllowed(async (userId) => {
        const state = userState(userId)
        if (state.statusMessageId != null) {
          await sendFns!.editText(
            userId,
            state.statusMessageId,
            formatTelegramActivityDone()
          )
        }
        if (finalText) {
          await sendFns!.sendMarkdownChunks(userId, finalText)
        }
        mirrorByUser.set(userId, emptyState())
      })
    } else if (event.type === 'assistant_images') {
      for (const img of event.images) {
        await forEachAllowed((userId) => sendFns!.sendPhoto(userId, img))
      }
    }
    return
  }

  // full mode: one short activity line (edited in place), then the final reply.
  switch (event.type) {
    case 'status': {
      const text = formatTelegramActivityFromStatus(event.phase, event.detail)
      await forEachAllowed(async (userId) => {
        await sendFns!.sendTyping(userId)
        if (text) await setActivityStatus(userId, text)
      })
      break
    }
    case 'thinking':
      // Backup when the model streams thinking without a status line first.
      if (event.content.trim()) {
        await forEachAllowed(async (userId) => {
          await setActivityStatus(userId, '💭 Thinking…')
        })
      }
      break
    case 'tool_start':
      await forEachAllowed(async (userId) => {
        await setActivityStatus(userId, formatTelegramActivityToolStart(event.name))
      })
      break
    case 'tool_result':
      await forEachAllowed(async (userId) => {
        await setActivityStatus(
          userId,
          formatTelegramActivityToolDone(event.name, event.ok)
        )
      })
      break
    case 'chunk':
      await forEachAllowed(async (userId) => {
        await setActivityStatus(userId, formatTelegramActivityWriting())
      })
      break
    case 'assistant_done': {
      const finalText = event.content ?? ''
      await forEachAllowed(async (userId) => {
        const state = userState(userId)
        if (state.statusMessageId != null) {
          await sendFns!.editText(
            userId,
            state.statusMessageId,
            formatTelegramActivityDone()
          )
        }
        if (finalText) {
          await sendFns!.sendMarkdownChunks(userId, finalText)
        }
        mirrorByUser.set(userId, emptyState())
      })
      break
    }
    case 'assistant_images':
      for (const img of event.images) {
        await forEachAllowed((userId) => sendFns!.sendPhoto(userId, img))
      }
      break
    case 'done':
      mirrorByUser.clear()
      activeTurnId = null
      break
    default:
      break
  }
}

export function startTelegramMirror(fns: TelegramSendFns): () => void {
  sendFns = fns
  return onChatEvent((event) => {
    eventChain = eventChain
      .then(() => handleEvent(event))
      .catch((err) => {
        console.error('[telegram-mirror] event error', err)
      })
  })
}
