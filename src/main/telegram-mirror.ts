import type { ChatEvent } from '../shared/types'
import { onChatEvent } from './chat-events'
import {
  getTelegramAllowedUserIds
} from './config-store'
import {
  formatTelegramActivityDone,
  formatTelegramActivityFromStatus,
  formatTelegramActivityToolDone,
  formatTelegramActivityToolStart
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
/** Skip redundant Telegram edits when status text is unchanged. */
const lastStatusTextByUser = new Map<number, string>()
let sendFns: TelegramSendFns | null = null
/** Only mirror turns started from Telegram (`beginTelegramActivity`). */
let mirroredTurnId: string | null = null
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
  lastStatusTextByUser.clear()
  mirroredTurnId = null
}

/** Immediate feedback when a Telegram user sends a message (before the agent emits events). */
export async function beginTelegramActivity(
  turnId: string,
  text: string
): Promise<void> {
  if (!sendFns) return
  mirroredTurnId = turnId
  mirrorByUser.clear()
  lastStatusTextByUser.clear()
  for (const userId of getTelegramAllowedUserIds()) {
    await sendFns.sendTyping(userId)
    await setActivityStatus(userId, text)
  }
}

function isMirroredEvent(event: ChatEvent): boolean {
  if (!mirroredTurnId) return false
  const turnId = 'turnId' in event ? event.turnId : undefined
  return turnId === mirroredTurnId
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
  if (lastStatusTextByUser.get(userId) === text) return
  lastStatusTextByUser.set(userId, text)
  const state = userState(userId)
  if (state.statusMessageId == null) {
    state.statusMessageId = await sendFns.sendStreamMessage(userId, text)
  } else {
    await sendFns.editText(userId, state.statusMessageId, text)
  }
}

async function handleEvent(event: ChatEvent): Promise<void> {
  if (!sendFns) return
  if (!isMirroredEvent(event)) return

  if (event.type === 'error') {
    await forEachAllowed((userId) =>
      sendFns!.sendText(userId, `⚠️ ${event.message}`)
    )
    return
  }

  switch (event.type) {
    case 'status': {
      const text = formatTelegramActivityFromStatus(event.phase, event.detail)
      if (text) {
        await forEachAllowed((userId) => setActivityStatus(userId, text))
      }
      break
    }
    // thinking/chunk are high-frequency stream events; status/tool_* already cover
    // the live line. Handling them here queued hundreds of Telegram edits and
    // blocked assistant_done behind a long reasoning phase.
    case 'thinking':
    case 'chunk':
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
        lastStatusTextByUser.delete(userId)
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
      lastStatusTextByUser.clear()
      if (event.turnId === mirroredTurnId) {
        mirroredTurnId = null
      }
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
