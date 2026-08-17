import type { ChatMessage } from './types'

export function estimateTokensFromChars(chars: number): number {
  if (chars <= 0) return 0
  return Math.ceil(chars / 4)
}

export function estimateTokensFromText(text: string): number {
  return estimateTokensFromChars(text.length)
}

/** Rough token estimate for model history (`ChatMessage[]`). */
export function estimateChatMessagesTokens(messages: ChatMessage[]): number {
  let chars = 0
  for (const m of messages) {
    chars += m.content?.length ?? 0
    if (m.tool_calls?.length) {
      chars += JSON.stringify(m.tool_calls).length
    }
    if (m.images?.length) {
      for (const img of m.images) {
        chars += Math.ceil(img.length / 8)
      }
    }
    if (m.tool_name) chars += m.tool_name.length
  }
  return estimateTokensFromChars(chars)
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) {
    const v = n / 1000
    return `${v < 10 ? v.toFixed(1) : Math.round(v)}k`
  }
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  const m = n / 1_000_000
  return `${m < 10 ? m.toFixed(1) : Math.round(m)}M`
}
