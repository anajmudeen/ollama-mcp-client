import { mcpManager } from './mcp-manager'

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

export function chunkTelegramHtml(html: string, max = TELEGRAM_MAX_MESSAGE_CHARS): string[] {
  if (!html) return ['']
  if (html.length <= max) return [html]

  const chunks: string[] = []
  let i = 0
  while (i < html.length) {
    let end = Math.min(i + max, html.length)
    if (end < html.length) {
      const slice = html.slice(i, end)
      const lastBreak = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'))
      if (lastBreak > max * 0.4) end = i + lastBreak + 1
    }
    chunks.push(html.slice(i, end))
    i = end
  }
  return chunks
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;')
}

function inlineMarkdownToHtml(text: string): string {
  const htmlParts: string[] = []
  const ph = (html: string): string => {
    const i = htmlParts.length
    htmlParts.push(html)
    return `\x00${i}\x00`
  }

  let s = text
  s = s.replace(/`([^`\n]+)`/g, (_, code: string) =>
    ph(`<code>${escapeHtml(code)}</code>`)
  )
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, url: string) =>
    ph(`<a href="${escapeHtmlAttr(url)}">${escapeHtml(label)}</a>`)
  )
  s = s.replace(/\*\*([^*\n]+)\*\*/g, (_, t: string) => ph(`<b>${escapeHtml(t)}</b>`))
  s = s.replace(/__([^_\n]+)__/g, (_, t: string) => ph(`<b>${escapeHtml(t)}</b>`))
  s = s.replace(/~~([^~\n]+)~~/g, (_, t: string) => ph(`<s>${escapeHtml(t)}</s>`))
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, (_, t: string) =>
    ph(`<i>${escapeHtml(t)}</i>`)
  )

  s = escapeHtml(s)
  return s.replace(/\x00(\d+)\x00/g, (_, index: string) => htmlParts[Number(index)]!)
}

const FENCED_CODE_RE = /```(\w*)\n?([\s\S]*?)```/g

/** Convert common Markdown (GFM-style) to Telegram HTML parse_mode. */
export function markdownToTelegramHtml(markdown: string): string {
  const parts: string[] = []
  let last = 0
  const re = new RegExp(FENCED_CODE_RE.source, 'g')
  let match: RegExpExecArray | null

  while ((match = re.exec(markdown)) !== null) {
    if (match.index > last) {
      parts.push(blockMarkdownToHtml(markdown.slice(last, match.index)))
    }
    const code = escapeHtml(match[2] ?? '')
    parts.push(`<pre><code>${code}</code></pre>`)
    last = re.lastIndex
  }

  if (last < markdown.length) {
    parts.push(blockMarkdownToHtml(markdown.slice(last)))
  }

  return parts.join('')
}

function blockMarkdownToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const heading = line.match(/^(#{1,6})\s+(.+)$/)
      if (heading) return `<b>${inlineMarkdownToHtml(heading[2]!)}</b>`
      return inlineMarkdownToHtml(line)
    })
    .join('\n')
}

export function truncateTelegramToolResult(text: string): string {
  if (text.length <= TELEGRAM_TOOL_RESULT_CHARS) return text
  return `${text.slice(0, TELEGRAM_TOOL_RESULT_CHARS)}…`
}

export function shortToolLabel(name: string): string {
  const idx = name.indexOf('__')
  return idx >= 0 ? name.slice(idx + 2) : name
}

export function formatTelegramToolDisplayLabel(prefixedName: string): string {
  const resolved = mcpManager.resolveToolDisplay(prefixedName)
  if (resolved) {
    return `${resolved.serverName} · ${resolved.toolName}`
  }
  return shortToolLabel(prefixedName)
}

export function formatTelegramActivityThinking(): string {
  return '💭 Thinking…'
}

export function formatTelegramActivityToolStart(name: string): string {
  return `🔧 Calling ${formatTelegramToolDisplayLabel(name)}…`
}

export function formatTelegramActivityToolDone(name: string, ok: boolean): string {
  const label = formatTelegramToolDisplayLabel(name)
  return ok ? `✅ ${label}` : `❌ ${label} failed`
}

export function formatTelegramActivityWriting(): string {
  return '✍️ Writing reply…'
}

export function formatTelegramActivityFromStatus(
  phase: string,
  detail?: string
): string | null {
  const text = detail?.trim()
  if (!text) return null
  switch (phase) {
    case 'thinking':
      return `💭 ${text}`
    case 'tool':
      return `🔧 ${text}`
    case 'generating':
    case 'synthesizing':
      return `✍️ ${text}`
    case 'compacting':
      return `📦 ${text}`
    default:
      return `⏳ ${text}`
  }
}

export function formatTelegramActivityDone(): string {
  return '✓ Done'
}

/** @deprecated Use formatTelegramActivityToolStart for Telegram status lines. */
export function formatToolStartLine(
  name: string,
  args: Record<string, unknown>
): string {
  const argStr = Object.keys(args).length ? ` ${JSON.stringify(args)}` : ''
  return `🔧 Calling ${name}${argStr}`
}

/** @deprecated Use formatTelegramActivityToolDone for Telegram status lines. */
export function formatToolResultLine(
  name: string,
  ok: boolean,
  result: string
): string {
  const prefix = ok ? '✅' : '❌'
  return `${prefix} ${name}: ${truncateTelegramToolResult(result)}`
}
