import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import type { ChatEvent, ChatMessage, ChatSendPayload } from '../shared/types'
import { mcpManager } from './mcp-manager'
import {
  chatStream,
  detectVisionSupport,
  getModelInfo,
  toOllamaMessages,
  type OllamaChatMessage,
  type OllamaTool
} from './ollama'

const MAX_TOOL_ITERATIONS = 8

let activeAbort: AbortController | null = null
let activeTurnId: string | null = null

function emit(event: ChatEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('chat:event', event)
  }
}

function toolsFromMcp(): OllamaTool[] {
  return mcpManager.listAllTools().map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.prefixedName,
      description: tool.description ?? `Tool ${tool.name} from ${tool.serverName}`,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} }
    }
  }))
}

export function abortChat(): void {
  if (activeAbort) {
    activeAbort.abort()
    activeAbort = null
  }
  activeTurnId = null
}

export async function runAgentTurn(payload: ChatSendPayload): Promise<void> {
  abortChat()
  const abort = new AbortController()
  activeAbort = abort
  const turnId = payload.turnId
  activeTurnId = turnId

  const emitTurn = (event: Exclude<ChatEvent, { type: 'user' }>): void => {
    emit({ ...event, turnId })
  }

  let emittedDone = false
  const finish = (): void => {
    if (emittedDone) return
    emittedDone = true
    emitTurn({ type: 'done' })
  }

  const tools = toolsFromMcp()
  const messages: OllamaChatMessage[] = toOllamaMessages(payload.messages)

  const imageStats = messages
    .filter((m) => m.images?.length)
    .map((m) => ({
      role: m.role,
      count: m.images!.length,
      bytes: m.images!.map((img) => img.length)
    }))
  if (imageStats.length) {
    console.log('[chat] image payloads', imageStats)
    const info = await getModelInfo(payload.model).catch(() => null)
    const support = detectVisionSupport(payload.model, info)
    if (support === 'no') {
      emitTurn({
        type: 'error',
        message: `Model "${payload.model}" does not support vision/images. Switch to a vision model (e.g. llava, llama3.2-vision, gemma3) and try again.`
      })
      finish()
      return
    }
    const empty = imageStats.some((s) => s.bytes.some((b) => b < 32))
    if (empty) {
      emitTurn({
        type: 'error',
        message: 'Attached image data was empty after transfer. Try a smaller JPEG/PNG.'
      })
      finish()
      return
    }
  }

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      if (abort.signal.aborted || activeTurnId !== turnId) {
        emitTurn({ type: 'error', message: 'Aborted' })
        return
      }

      emitTurn({
        type: 'status',
        phase: iteration === 0 ? 'thinking' : 'synthesizing',
        detail:
          iteration === 0
            ? 'Waiting for the model…'
            : `Continuing after tools (step ${iteration + 1})…`
      })

      let streamedContent = ''
      let sawContent = false
      let sawThinking = false

      const { content, toolCalls } = await chatStream({
        model: payload.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        signal: abort.signal,
        onChunk: (chunk) => {
          if (activeTurnId !== turnId) return

          const thinking = chunk.message?.thinking
          if (thinking) {
            if (!sawThinking) {
              sawThinking = true
              emitTurn({
                type: 'status',
                phase: 'thinking',
                detail: 'Model is reasoning…'
              })
            }
            emitTurn({ type: 'thinking', content: thinking })
          }

          const text = chunk.message?.content
          if (text) {
            if (!sawContent) {
              sawContent = true
              emitTurn({
                type: 'status',
                phase: 'generating',
                detail: 'Writing a reply…'
              })
            }
            streamedContent += text
            emitTurn({ type: 'chunk', content: text })
          }

          if (chunk.message?.tool_calls?.length && !sawContent) {
            emitTurn({
              type: 'status',
              phase: 'tool',
              detail: 'Choosing tools…'
            })
          }
        }
      })

      if (abort.signal.aborted || activeTurnId !== turnId) {
        emitTurn({ type: 'error', message: 'Aborted' })
        return
      }

      const finalContent = content || streamedContent

      if (toolCalls.length === 0) {
        // Always complete the turn so the UI leaves thinking/synthesizing,
        // even when the model returns an empty final message after tools.
        emitTurn({ type: 'assistant_done', content: finalContent })
        return
      }

      const assistantMsg: OllamaChatMessage = {
        role: 'assistant',
        content: finalContent,
        tool_calls: toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: tc.arguments }
        }))
      }
      messages.push(assistantMsg)

      for (const tc of toolCalls) {
        const id = randomUUID()
        const shortName = tc.name.includes('__')
          ? tc.name.split('__').slice(1).join('__')
          : tc.name
        emitTurn({
          type: 'status',
          phase: 'tool',
          detail: `Calling ${shortName}…`
        })
        emitTurn({
          type: 'tool_start',
          id,
          name: tc.name,
          arguments: tc.arguments
        })

        const { ok, result } = await mcpManager.callTool(tc.name, tc.arguments)
        emitTurn({
          type: 'tool_result',
          id,
          name: tc.name,
          ok,
          result
        })

        messages.push({
          role: 'tool',
          content: result,
          tool_name: tc.name
        })
      }
    }

    emitTurn({
      type: 'error',
      message: `Stopped after ${MAX_TOOL_ITERATIONS} tool iterations`
    })
  } catch (err) {
    if (abort.signal.aborted || activeTurnId !== turnId) {
      emitTurn({ type: 'error', message: 'Aborted' })
    } else {
      const raw = err instanceof Error ? err.message : String(err)
      emitTurn({
        type: 'error',
        message: raw
      })
    }
  } finally {
    if (activeTurnId === turnId) {
      finish()
      activeAbort = null
      activeTurnId = null
    }
  }
}

export type { ChatMessage }
