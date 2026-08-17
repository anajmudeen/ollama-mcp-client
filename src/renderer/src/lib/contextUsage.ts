import type { McpToolInfo, UiMessage } from '../../../shared/types'
import { estimateTokensFromChars } from '../../../shared/contextUsage'
import type { ChatAttachment } from './attachments'

export {
  estimateTokensFromChars,
  estimateTokensFromText,
  estimateChatMessagesTokens,
  formatTokenCount
} from '../../../shared/contextUsage'

export function estimateMessageTokens(messages: UiMessage[]): number {
  let chars = 0
  for (const m of messages) {
    if (
      m.kind === 'user' ||
      m.kind === 'assistant' ||
      m.kind === 'thinking' ||
      m.kind === 'error'
    ) {
      chars += m.content.length
    } else if (m.kind === 'tool') {
      chars += m.name.length
      chars += JSON.stringify(m.arguments).length
      chars += m.result?.length ?? 0
    }
    // notice: negligible / not sent to the model
  }
  return estimateTokensFromChars(chars)
}

export function estimateToolSchemaTokens(tools: McpToolInfo[]): number {
  if (tools.length === 0) return 0
  let chars = 0
  for (const t of tools) {
    chars += t.prefixedName.length
    chars += t.description?.length ?? 0
    if (t.inputSchema) chars += JSON.stringify(t.inputSchema).length
  }
  return estimateTokensFromChars(chars)
}

export function estimateDraftTokens(
  draft: string,
  attachments: ChatAttachment[]
): number {
  let chars = draft.length
  for (const file of attachments) {
    if (file.textContent) chars += file.textContent.length
    else if (file.imageBase64) chars += Math.ceil(file.imageBase64.length / 8)
  }
  return estimateTokensFromChars(chars)
}

export function contextUsageColor(pct: number): string {
  if (pct >= 90) return '#f0a0a0'
  if (pct >= 70) return '#e0c070'
  return '#8b9aab'
}
