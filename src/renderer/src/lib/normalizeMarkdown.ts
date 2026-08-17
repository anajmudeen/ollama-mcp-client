/**
 * Models often indent reasoning/lists with 4+ spaces. CommonMark treats that as
 * a code block, so bullets show up as literal "* …" in a monospace box.
 * Also sanitize currency symbols inside $math$ that KaTeX cannot render (e.g. ₹).
 * llama.cpp byte-fallback tokens (`<0xF0><0x9F>…`) are decoded to UTF-8.
 */
export function normalizeMarkdown(source: string): string {
  const text = decodeByteFallbackTokens(source.replace(/\r\n/g, '\n'))
  if (!text.trim()) return source

  const lines = text.split('\n')
  const nonEmpty = lines.filter((l) => l.trim().length > 0)
  const minIndent = Math.min(...nonEmpty.map(leadingWidth))

  const dedented =
    minIndent > 0
      ? lines.map((l) => (l.trim() ? stripWidth(l, minIndent) : l))
      : lines

  const unindentedLists = unindentOrphanLists(dedented).join('\n')

  return sanitizeMathCurrency(unindentedLists)
}

/** KaTeX has no glyph metrics for many currency symbols (₹, etc.). */
const MATH_CURRENCY_REPLACEMENTS: Array<[string, string]> = [
  ['₹', '\\text{Rs.}'],
  ['€', '\\euro'],
  ['£', '\\pounds'],
  ['¥', '\\yen']
]

const BYTE_FALLBACK_RUN = /(?:<0x[0-9A-Fa-f]{2}>)+/g
const BYTE_FALLBACK_BYTE = /<0x([0-9A-Fa-f]{2})>/gi

/**
 * llama.cpp emits unknown UTF-8 as hex tokens instead of the character.
 * Decode consecutive runs; leave incomplete trailing bytes as-is for streaming.
 */
function decodeByteFallbackTokens(source: string): string {
  return source.replace(BYTE_FALLBACK_RUN, (run) => {
    const bytes = [...run.matchAll(BYTE_FALLBACK_BYTE)].map((m) =>
      parseInt(m[1], 16)
    )
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let validLen = bytes.length
    while (validLen > 0) {
      try {
        const decoded = decoder.decode(new Uint8Array(bytes.slice(0, validLen)))
        return decoded + formatByteTokens(bytes.slice(validLen))
      } catch {
        validLen -= 1
      }
    }
    return run
  })
}

function formatByteTokens(bytes: number[]): string {
  return bytes
    .map((b) => `<0x${b.toString(16).toUpperCase().padStart(2, '0')}>`)
    .join('')
}

function sanitizeMathCurrency(source: string): string {
  let out = source.replace(/\$\$([\s\S]+?)\$\$/g, (_m, body: string) => {
    return `$$${replaceCurrencyInMath(body)}$$`
  })
  out = out.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_m, body: string) => {
    return `$${replaceCurrencyInMath(body)}$`
  })
  return out
}

function replaceCurrencyInMath(body: string): string {
  let next = body
  for (const [char, repl] of MATH_CURRENCY_REPLACEMENTS) {
    if (next.includes(char)) next = next.split(char).join(repl)
  }
  return next
}

/**
 * Models often indent a whole list with 4+ spaces, which CommonMark treats as a
 * code block. Only flatten those orphan lists — keep nested items under a
 * less-indented parent (`* parent` / `    * child`).
 */
function unindentOrphanLists(lines: string[]): string[] {
  const stack: number[] = []

  return lines.map((line) => {
    if (!line.trim()) return line

    const indented = /^(?<indent>[ \t]+)(?<marker>[-*+]|\d+\.)(?<gap>\s+)(?<rest>.*)$/.exec(
      line
    )
    let indent: number
    let flatten: string | null = null
    if (indented?.groups) {
      indent = leadingWidth(indented.groups.indent)
      flatten = `${indented.groups.marker}${indented.groups.gap}${indented.groups.rest}`
    } else if (/^([-*+]|\d+\.)\s+/.test(line)) {
      indent = 0
    } else {
      if (leadingWidth(line) === 0) stack.length = 0
      return line
    }

    while (stack.length > 0 && stack[stack.length - 1] >= indent) {
      stack.pop()
    }
    const orphan = indent >= 4 && stack.length === 0 && flatten != null
    stack.push(indent)
    return orphan && flatten != null ? flatten : line
  })
}

function leadingWidth(line: string): number {
  let width = 0
  for (const ch of line) {
    if (ch === ' ') width += 1
    else if (ch === '\t') width += 4
    else break
  }
  return width
}

function stripWidth(line: string, width: number): string {
  let left = width
  let i = 0
  while (i < line.length && left > 0) {
    const ch = line[i]
    if (ch === ' ') {
      left -= 1
      i += 1
    } else if (ch === '\t') {
      left -= 4
      i += 1
    } else {
      break
    }
  }
  return line.slice(i)
}
