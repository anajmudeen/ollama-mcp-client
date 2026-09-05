import { Input, Telegraf } from 'telegraf'
import type { Context } from 'telegraf'
import type { TelegramStatus } from '../shared/types'
import {
  addTelegramAllowedUserId,
  createSession,
  deleteSession,
  getActiveSessionId,
  getSelectedModel,
  getSessionsState,
  getTelegramAllowedUserIds,
  getTelegramBotToken,
  getTelegramEnabled,
  setActiveSession
} from './config-store'
import { broadcastSessionsChanged } from './sessions-broadcast'
import {
  chunkTelegramHtml,
  chunkTelegramText,
  markdownToTelegramHtml
} from './telegram-format'
import {
  resetTelegramMirrorState,
  startTelegramMirror,
  type TelegramSendFns
} from './telegram-mirror'
import { runTelegramTurn } from './telegram-turn'

let bot: Telegraf | null = null
let running = false
let lastError: string | undefined
let stopMirror: (() => void) | null = null
let botUsername: string | undefined
const unauthorizedNotified = new Set<number>()

function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === 'private'
}

function createSendFns(telegram: Telegraf['telegram']): TelegramSendFns {
  return {
    sendText: async (userId, text) => {
      await telegram.sendMessage(userId, text)
    },
    sendMarkdownChunks: async (userId, markdown) => {
      const html = markdownToTelegramHtml(markdown)
      const chunks = chunkTelegramHtml(html)
      const plainChunks = chunkTelegramText(markdown)
      for (let i = 0; i < chunks.length; i++) {
        const htmlChunk = chunks[i]!
        try {
          await telegram.sendMessage(userId, htmlChunk, { parse_mode: 'HTML' })
        } catch {
          await telegram.sendMessage(userId, plainChunks[i] ?? htmlChunk)
        }
      }
    },
    sendStreamMessage: async (userId, text) => {
      const msg = await telegram.sendMessage(userId, text)
      return msg.message_id
    },
    editText: async (userId, messageId, text) => {
      try {
        await telegram.editMessageText(userId, messageId, undefined, text)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (!message.includes('message is not modified')) {
          console.error('[telegram] editMessageText failed:', message)
          throw err
        }
      }
    },
    sendPhoto: async (userId, base64, caption) => {
      await telegram.sendPhoto(userId, Input.fromBuffer(Buffer.from(base64, 'base64')), {
        caption
      })
    },
    sendTyping: async (userId) => {
      await telegram.sendChatAction(userId, 'typing')
    }
  }
}

function resolveSessionArg(arg: string): string | null {
  const trimmed = arg.trim()
  if (!trimmed) return null

  const sessions = getSessionsState().sessions
  const index = Number.parseInt(trimmed, 10)
  if (Number.isFinite(index) && index >= 1 && index <= sessions.length) {
    return sessions[index - 1]!.id
  }

  const lower = trimmed.toLowerCase()
  const match = sessions.find((s) => s.title.toLowerCase().includes(lower))
  return match?.id ?? null
}

function activeSessionTitle(): string {
  const state = getSessionsState()
  const activeId = getActiveSessionId() ?? state.activeSessionId
  const session = state.sessions.find((s) => s.id === activeId)
  return session?.title ?? 'No active session'
}

async function authMiddleware(ctx: Context, next: () => Promise<void>): Promise<void> {
  if (!isPrivateChat(ctx)) return

  const userId = ctx.from?.id
  if (userId == null) return

  let allowlist = getTelegramAllowedUserIds()

  // First contact: claim owner when allowlist is still empty (/start or any message).
  if (allowlist.length === 0) {
    allowlist = addTelegramAllowedUserId(userId)
    unauthorizedNotified.delete(userId)
    return next()
  }

  if (!allowlist.includes(userId)) {
    if (!unauthorizedNotified.has(userId)) {
      unauthorizedNotified.add(userId)
      await ctx.reply(
        `Unauthorized. Your Telegram user ID is ${userId}.\n\n` +
          'Ask the bot owner to add this ID in the desktop app: Settings → Telegram → Allowed user IDs.\n' +
          'Or send /start if you are setting up this bot for the first time.'
      )
    }
    return
  }

  return next()
}

function registerHandlers(instance: Telegraf): void {
  instance.command('start', async (ctx) => {
    const userId = ctx.from?.id
    if (userId == null) return
    await ctx.reply(
      `Welcome to Ollama MCP.\n\nYour Telegram user ID: ${userId}\n\nSend a message to chat with the active desktop session, or use /help for commands.`
    )
  })

  instance.command('help', async (ctx) => {
    await ctx.reply(
      [
        'Commands:',
        '/start — welcome and your user ID',
        '/help — this message',
        '/new — create a new chat session',
        '/sessions — list sessions (tap to switch)',
        '/switch <n|title> — switch active session',
        '/delete <n|title> — delete a session',
        '/current — show active session info',
        '',
        `Current session: ${activeSessionTitle()}`
      ].join('\n')
    )
  })

  instance.command('new', async (ctx) => {
    const session = createSession()
    broadcastSessionsChanged()
    await ctx.reply(`Created new session: ${session.title}`)
  })

  instance.command('sessions', async (ctx) => {
    const state = getSessionsState()
    const sessions = state.sessions.slice(0, 10)
    if (sessions.length === 0) {
      await ctx.reply('No sessions yet. Use /new to create one.')
      return
    }

    const activeId = getActiveSessionId() ?? state.activeSessionId
    const lines = sessions.map((s, i) => {
      const marker = s.id === activeId ? ' •' : ''
      return `${i + 1}. ${s.title}${marker}`
    })

    const keyboard = sessions.map((s) => [
      { text: s.title, callback_data: `switch:${s.id}` }
    ])

    await ctx.reply(lines.join('\n'), {
      reply_markup: { inline_keyboard: keyboard }
    })
  })

  instance.command('switch', async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : ''
    const arg = text.replace(/^\/switch(@\w+)?\s*/i, '').trim()
    if (!arg) {
      await ctx.reply('Usage: /switch <number|title>')
      return
    }

    const sessionId = resolveSessionArg(arg)
    if (!sessionId) {
      await ctx.reply('Session not found.')
      return
    }

    setActiveSession(sessionId)
    broadcastSessionsChanged()
    const title = getSessionsState().sessions.find((s) => s.id === sessionId)?.title
    await ctx.reply(`Switched to: ${title ?? sessionId}`)
  })

  instance.command('delete', async (ctx) => {
    const state = getSessionsState()
    if (state.sessions.length <= 1) {
      await ctx.reply('Cannot delete the only session.')
      return
    }

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : ''
    const arg = text.replace(/^\/delete(@\w+)?\s*/i, '').trim()
    if (!arg) {
      await ctx.reply('Usage: /delete <number|title>')
      return
    }

    const sessionId = resolveSessionArg(arg)
    if (!sessionId) {
      await ctx.reply('Session not found.')
      return
    }

    const title = state.sessions.find((s) => s.id === sessionId)?.title ?? sessionId
    await ctx.reply(`Delete session "${title}"?`, {
      reply_markup: {
        inline_keyboard: [[{ text: 'Confirm delete', callback_data: `delete:${sessionId}` }]]
      }
    })
  })

  instance.command('current', async (ctx) => {
    const state = getSessionsState()
    const activeId = getActiveSessionId() ?? state.activeSessionId
    const session = state.sessions.find((s) => s.id === activeId)
    if (!session) {
      await ctx.reply('No active session.')
      return
    }

    const model = getSelectedModel()
    await ctx.reply(
      [
        `Session: ${session.title}`,
        `Messages: ${session.uiMessages.length}`,
        `Model: ${model ?? '(not selected — choose one in the desktop app)'}`
      ].join('\n')
    )
  })

  instance.command('mirror', async (ctx) => {
    await ctx.reply(
      'Live status is always on: one line updates for thinking, tool calls, and writing, then the final reply.'
    )
  })

  instance.on('text', async (ctx) => {
    const text = ctx.message.text
    if (text.startsWith('/')) return

    const userId = ctx.from?.id
    if (userId != null) {
      void ctx.sendChatAction('typing')
    }

    const result = await runTelegramTurn(text)
    if (!result.ok) {
      await ctx.reply(result.error)
    }
  })

  instance.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined
    if (!data) {
      await ctx.answerCbQuery()
      return
    }

    if (data.startsWith('switch:')) {
      const sessionId = data.slice('switch:'.length)
      try {
        setActiveSession(sessionId)
        broadcastSessionsChanged()
        const title = getSessionsState().sessions.find((s) => s.id === sessionId)?.title
        await ctx.answerCbQuery(`Switched to ${title ?? sessionId}`)
      } catch {
        await ctx.answerCbQuery('Session not found')
      }
      return
    }

    if (data.startsWith('delete:')) {
      const sessionId = data.slice('delete:'.length)
      deleteSession(sessionId)
      broadcastSessionsChanged()
      await ctx.answerCbQuery('Session deleted')
      return
    }

    await ctx.answerCbQuery()
  })
}

export function getTelegramBotStatus(): TelegramStatus {
  return { running, error: lastError, botUsername }
}

export async function startTelegramBot(): Promise<void> {
  const token = getTelegramBotToken()
  const enabled = getTelegramEnabled()
  if (!enabled || !token) return

  try {
    const instance = new Telegraf(token)
    instance.use(authMiddleware)
    registerHandlers(instance)

    stopMirror = startTelegramMirror(createSendFns(instance.telegram))

    const me = await instance.telegram.getMe()
    bot = instance
    running = true
    lastError = undefined
    botUsername = me.username

    // launch() runs until stop() — must not block app startup
    void instance.launch().catch((err) => {
      lastError = err instanceof Error ? err.message : String(err)
      running = false
      bot = null
      stopMirror?.()
      stopMirror = null
      resetTelegramMirrorState()
      console.error('[telegram] bot stopped:', lastError)
    })
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    running = false
    bot = null
    stopMirror?.()
    stopMirror = null
    resetTelegramMirrorState()
  }
}

export async function stopTelegramBot(): Promise<void> {
  stopMirror?.()
  stopMirror = null

  if (bot) {
    try {
      bot.stop('shutdown')
    } catch {
      // ignore stop errors during shutdown
    }
  }

  bot = null
  running = false
  botUsername = undefined
  resetTelegramMirrorState()
}

export async function restartTelegramBot(): Promise<void> {
  await stopTelegramBot()
  await startTelegramBot()
}
