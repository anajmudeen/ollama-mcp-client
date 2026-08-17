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

/** Context windows are binary (128k = 131072). Divide by 1024, not 1000. */
const TOKENS_PER_K = 1024

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n < TOKENS_PER_K) return String(Math.round(n))
  if (n < TOKENS_PER_K * 10) {
    const v = n / TOKENS_PER_K
    const rounded = Math.round(v * 10) / 10
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}k`
  }
  if (n < TOKENS_PER_K * TOKENS_PER_K) return `${Math.round(n / TOKENS_PER_K)}k`
  const m = n / (TOKENS_PER_K * TOKENS_PER_K)
  const rounded = Math.round(m * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}M`
}
