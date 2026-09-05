import type { ChatEvent } from '../shared/types'
import { onChatEvent } from './chat-events'
import {
  getTelegramAllowedUserIds,
  getTelegramMirrorMode
} from './config-store'
import { chunkTelegramText, formatToolResultLine, formatToolStartLine } from './telegram-format'

export interface TelegramSendFns {
  sendText: (userId: number, text: string) => Promise<void>
  sendTextChunks: (userId: number, text: string) => Promise<void>
  editText: (userId: number, messageId: number, text: string) => Promise<void>
  sendPhoto: (userId: number, base64: string, caption?: string) => Promise<void>
  sendTyping: (userId: number) => Promise<void>
}

type StreamState = {
  messageId: number | null
  buffer: string
  lastEditAt: number
}

const streamByUser = new Map<number, StreamState>()
let sendFns: TelegramSendFns | null = null

export function resetTelegramMirrorState(): void {
  streamByUser.clear()
}

async function forEachAllowed(
  fn: (userId: number) => Promise<void>
): Promise<void> {
  const ids = getTelegramAllowedUserIds()
  for (const userId of ids) {
    await fn(userId)
  }
}

async function handleEvent(event: ChatEvent): Promise<void> {
  if (!sendFns) return
  const mode = getTelegramMirrorMode()

  if (event.type === 'error') {
    await forEachAllowed((userId) =>
      sendFns!.sendText(userId, `⚠️ ${event.message}`)
    )
    return
  }

  if (mode === 'final') {
    if (event.type === 'assistant_done' && event.content) {
      await forEachAllowed((userId) =>
        sendFns!.sendTextChunks(userId, event.content)
      )
    } else if (event.type === 'assistant_images') {
      for (const img of event.images) {
        await forEachAllowed((userId) => sendFns!.sendPhoto(userId, img))
      }
    }
    return
  }

  // full mode
  switch (event.type) {
    case 'status':
      await forEachAllowed((userId) => sendFns!.sendTyping(userId))
      if (event.detail) {
        await forEachAllowed((userId) =>
          sendFns!.sendText(userId, `⏳ ${event.detail}`)
        )
      }
      break
    case 'thinking':
      if (event.content.trim()) {
        await forEachAllowed((userId) =>
          sendFns!.sendText(userId, `💭 ${event.content}`)
        )
      }
      break
    case 'tool_start':
      await forEachAllowed((userId) =>
        sendFns!.sendText(
          userId,
          formatToolStartLine(event.name, event.arguments)
        )
      )
      break
    case 'tool_result':
      await forEachAllowed((userId) =>
        sendFns!.sendText(
          userId,
          formatToolResultLine(event.name, event.ok, event.result)
        )
      )
      break
    case 'chunk': {
      await forEachAllowed(async (userId) => {
        const state = streamByUser.get(userId) ?? {
          messageId: null,
          buffer: '',
          lastEditAt: 0
        }
        state.buffer += event.content
        streamByUser.set(userId, state)

        const now = Date.now()
        if (state.messageId == null) {
          const chunks = chunkTelegramText(state.buffer)
          await sendFns!.sendText(userId, chunks[0] ?? '…')
          // messageId set by sendFns implementation via callback — see Task 6
        } else if (now - state.lastEditAt >= 1000) {
          state.lastEditAt = now
          const chunks = chunkTelegramText(state.buffer)
          await sendFns!.editText(userId, state.messageId, chunks[0] ?? '…')
        }
      })
      break
    }
    case 'assistant_done': {
      await forEachAllowed(async (userId) => {
        const state = streamByUser.get(userId)
        if (state?.messageId != null) {
          const chunks = chunkTelegramText(event.content || state.buffer)
          await sendFns!.editText(userId, state.messageId, chunks[0] ?? '')
          if (chunks.length > 1) {
            for (let i = 1; i < chunks.length; i++) {
              await sendFns!.sendText(userId, chunks[i]!)
            }
          }
        } else if (event.content) {
          await sendFns!.sendTextChunks(userId, event.content)
        }
        streamByUser.delete(userId)
      })
      break
    }
    case 'assistant_images':
      for (const img of event.images) {
        await forEachAllowed((userId) => sendFns!.sendPhoto(userId, img))
      }
      break
    case 'done':
      streamByUser.clear()
      break
    default:
      break
  }
}

export function startTelegramMirror(fns: TelegramSendFns): () => void {
  sendFns = fns
  return onChatEvent((event) => {
    void handleEvent(event)
  })
}

export function setStreamMessageId(userId: number, messageId: number): void {
  const state = streamByUser.get(userId)
  if (!state || state.messageId != null) return
  state.messageId = messageId
  state.lastEditAt = Date.now()
  streamByUser.set(userId, state)
}
