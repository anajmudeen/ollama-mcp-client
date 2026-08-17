import type { ChatMessage } from '../shared/types'
import { estimateChatMessagesTokens } from '../shared/contextUsage'
import { chatOnce } from './ollama'

/** Trigger compaction when estimated usage reaches this fraction of the limit. */
export const COMPACT_THRESHOLD = 0.75
/** Leave roughly this fraction free for the reply + tools after compact. */
const TARGET_HEADROOM = 0.25
const MIN_MESSAGES_TO_COMPACT = 6
const DEFAULT_KEEP_TURNS = 6
const MIN_KEEP_TURNS = 2
const SUMMARY_PREFIX = 'Conversation summary (earlier messages compacted):\n\n'

export function isSummaryMessage(m: ChatMessage): boolean {
  return (
    (m.role === 'system' || m.role === 'user') &&
    m.content.startsWith('Conversation summary (earlier messages compacted):')
  )
}

export function shouldCompact(
  messages: ChatMessage[],
  limit: number | undefined,
  measuredUsed?: number | null
): boolean {
  if (!limit || limit <= 0) return false
  if (messages.length < MIN_MESSAGES_TO_COMPACT) return false
  const estimated = estimateChatMessagesTokens(messages)
  const used = Math.max(estimated, measuredUsed ?? 0)
  return used >= limit * COMPACT_THRESHOLD
}

/**
 * Split history into older (to summarize) and recent (keep verbatim).
 * A "turn" starts at a user message and includes following assistant/tool msgs.
 */
export function splitForCompact(
  messages: ChatMessage[],
  keepTurns = DEFAULT_KEEP_TURNS
): { older: ChatMessage[]; recent: ChatMessage[] } {
  if (messages.length === 0) return { older: [], recent: [] }

  const turnStarts: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') turnStarts.push(i)
  }

  if (turnStarts.length <= keepTurns) {
    // Not enough user turns — keep a message-count tail instead
    const keepCount = Math.max(4, Math.min(messages.length - 2, messages.length))
    if (keepCount >= messages.length) {
      return { older: [], recent: messages }
    }
    return {
      older: messages.slice(0, messages.length - keepCount),
      recent: messages.slice(messages.length - keepCount)
    }
  }

  const startIdx = turnStarts[turnStarts.length - keepTurns]
  return {
    older: messages.slice(0, startIdx),
    recent: messages.slice(startIdx)
  }
}

function formatMessagesForSummary(messages: ChatMessage[]): string {
  const parts: string[] = []
  for (const m of messages) {
    if (isSummaryMessage(m)) {
      parts.push(`[Prior summary]\n${m.content.replace(SUMMARY_PREFIX, '')}`)
      continue
    }
    const role = m.role.toUpperCase()
    let body = m.content?.trim() ?? ''
    if (m.tool_calls?.length) {
      body +=
        (body ? '\n' : '') +
        m.tool_calls
          .map(
            (tc) =>
              `[tool call] ${tc.name}(${JSON.stringify(tc.arguments)})`
          )
          .join('\n')
    }
    if (m.tool_name) {
      body = `[tool result: ${m.tool_name}]\n${body}`
    }
    if (m.images?.length) {
      body += (body ? '\n' : '') + `[${m.images.length} image(s) attached]`
    }
    if (!body) continue
    // Cap very long tool dumps in the summarizer prompt
    if (body.length > 4000) {
      body = `${body.slice(0, 4000)}\n…[truncated]`
    }
    parts.push(`${role}:\n${body}`)
  }
  return parts.join('\n\n')
}

export async function summarizeHistory(options: {
  model: string
  older: ChatMessage[]
  signal?: AbortSignal
}): Promise<string> {
  const transcript = formatMessagesForSummary(options.older)
  const content = await chatOnce({
    model: options.model,
    signal: options.signal,
    messages: [
      {
        role: 'system',
        content:
          'You compress chat history for a coding assistant. Write a concise summary that preserves: user goals, key decisions, facts, file/tool outcomes, and open tasks. Omit fluff and repeated back-and-forth. Use short bullets or tight paragraphs. Do not continue the conversation — only output the summary.'
      },
      {
        role: 'user',
        content: `Summarize this earlier conversation:\n\n${transcript}`
      }
    ]
  })
  if (!content) {
    throw new Error('Summarizer returned empty content')
  }
  return content
}

function makeSummaryMessage(summary: string): ChatMessage {
  return {
    role: 'system',
    content: `${SUMMARY_PREFIX}${summary}`
  }
}

/** Drop oldest non-summary messages until under target token budget. */
export function truncateOldest(
  messages: ChatMessage[],
  limit: number,
  headroom = TARGET_HEADROOM
): ChatMessage[] {
  const target = Math.floor(limit * (1 - headroom))
  if (estimateChatMessagesTokens(messages) <= target) return messages

  const out = [...messages]
  while (out.length > 2 && estimateChatMessagesTokens(out) > target) {
    // Prefer dropping just after an existing summary, else from the front
    const dropIdx = isSummaryMessage(out[0]) && out.length > 1 ? 1 : 0
    out.splice(dropIdx, 1)
  }
  return out
}

export interface CompactResult {
  messages: ChatMessage[]
  summarized: boolean
  summary?: string
}

/**
 * Compact model history when near the context limit.
 * On summarizer failure, falls back to truncating oldest messages.
 */
export async function compactIfNeeded(options: {
  model: string
  messages: ChatMessage[]
  limit: number | undefined
  measuredUsed?: number | null
  signal?: AbortSignal
}): Promise<CompactResult> {
  const { model, limit, measuredUsed, signal } = options
  const messages = options.messages

  if (!shouldCompact(messages, limit, measuredUsed) || !limit) {
    return { messages, summarized: false }
  }

  // Avoid re-summarizing if we only have a summary + short recent tail
  const nonSummary = messages.filter((m) => !isSummaryMessage(m))
  if (nonSummary.length < MIN_MESSAGES_TO_COMPACT) {
    const trimmed = truncateOldest(messages, limit)
    return {
      messages: trimmed,
      summarized: trimmed.length < messages.length
    }
  }

  let keepTurns = DEFAULT_KEEP_TURNS
  let older: ChatMessage[] = []
  let recent: ChatMessage[] = messages

  // Shrink keep-tail until older is non-empty and recent fits headroom budget
  const recentBudget = Math.floor(limit * (1 - TARGET_HEADROOM) * 0.7)
  while (keepTurns >= MIN_KEEP_TURNS) {
    ;({ older, recent } = splitForCompact(messages, keepTurns))
    if (older.length === 0) {
      return { messages, summarized: false }
    }
    if (estimateChatMessagesTokens(recent) <= recentBudget) break
    keepTurns -= 1
  }

  // If older is only an existing summary, fold by truncating instead
  if (older.every(isSummaryMessage) && older.length <= 1) {
    const trimmed = truncateOldest(messages, limit)
    return {
      messages: trimmed,
      summarized: trimmed.length < messages.length
    }
  }

  try {
    const summary = await summarizeHistory({ model, older, signal })
    if (signal?.aborted) {
      return { messages, summarized: false }
    }
    let compacted: ChatMessage[] = [makeSummaryMessage(summary), ...recent]

    // Safety: still over limit → drop more from the front of recent
    if (estimateChatMessagesTokens(compacted) > limit * COMPACT_THRESHOLD) {
      compacted = truncateOldest(compacted, limit)
    }

    return { messages: compacted, summarized: true, summary }
  } catch (err) {
    if (signal?.aborted) {
      return { messages, summarized: false }
    }
    console.warn(
      '[compact] summarizer failed, truncating oldest:',
      err instanceof Error ? err.message : err
    )
    const trimmed = truncateOldest(messages, limit)
    return {
      messages: trimmed,
      summarized: trimmed.length < messages.length
    }
  }
}
