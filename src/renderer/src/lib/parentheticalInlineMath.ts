function isEscaped(source: string, index: number): boolean {
  let n = 0
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i--) n += 1
  return n % 2 === 1
}

export function looksLikeParentheticalMath(body: string): boolean {
  const t = body.trim()
  if (!t) return false
  if (/[A-Za-z]:\\/.test(t)) return false
  return /\\[a-zA-Z@]+/.test(t)
}

function findMatchingCloseParen(source: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]
    if (ch === '(' && !isEscaped(source, i)) depth += 1
    else if (ch === ')' && !isEscaped(source, i)) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** Rewrite model `( … )` inline math that contains LaTeX commands to `$…$`. */
export function convertParentheticalInlineMath(segment: string): string {
  let out = ''
  let i = 0
  let inDisplay = false
  let inInline = false

  while (i < segment.length) {
    if (!inInline && segment.startsWith('$$', i) && !isEscaped(segment, i)) {
      inDisplay = !inDisplay
      out += '$$'
      i += 2
      continue
    }
    if (
      !inDisplay &&
      segment[i] === '$' &&
      !isEscaped(segment, i) &&
      !segment.startsWith('$$', i)
    ) {
      inInline = !inInline
      out += '$'
      i += 1
      continue
    }

    if (!inInline && !inDisplay && segment[i] === '(' && !isEscaped(segment, i)) {
      if (i > 0 && segment[i - 1] === ']') {
        out += '('
        i += 1
        continue
      }
      const close = findMatchingCloseParen(segment, i)
      if (close === -1) {
        out += '('
        i += 1
        continue
      }
      const body = segment.slice(i + 1, close)
      if (looksLikeParentheticalMath(body)) {
        out += `$${body.trim()}$`
        i = close + 1
        continue
      }
    }

    out += segment[i]
    i += 1
  }

  return out
}
