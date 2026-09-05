export const TELEGRAM_MAX_MESSAGE_CHARS = 4096
export const TELEGRAM_TOOL_RESULT_CHARS = 500

export function chunkTelegramText(text: string): string[] {
  if (!text) return ['']
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    chunks.push(text.slice(i, i + TELEGRAM_MAX_MESSAGE_CHARS))
    i += TELEGRAM_MAX_MESSAGE_CHARS
  }
  return chunks
}

export function truncateTelegramToolResult(text: string): string {
  if (text.length <= TELEGRAM_TOOL_RESULT_CHARS) return text
  return `${text.slice(0, TELEGRAM_TOOL_RESULT_CHARS)}…`
}

export function formatToolStartLine(
  name: string,
  args: Record<string, unknown>
): string {
  const argStr = Object.keys(args).length ? ` ${JSON.stringify(args)}` : ''
  return `🔧 Calling ${name}${argStr}`
}

export function formatToolResultLine(
  name: string,
  ok: boolean,
  result: string
): string {
  const prefix = ok ? '✅' : '❌'
  return `${prefix} ${name}: ${truncateTelegramToolResult(result)}`
}
