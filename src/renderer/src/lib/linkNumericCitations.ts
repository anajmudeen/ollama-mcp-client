/** Vancouver-style `[1]` / `[2, 3]` / `[6-8]` → links to `#ref-N`. */

const CITE_RE = /(?<![!\]])\[(?!\^)(\d+(?:\s*[,–—-]\s*\d+)*)\](?![:(\[])/g
const REF_LINE_RE = /^(\s*)\[(\d+)\](?![:(\[])(\s+)(.*)$/

type CitePart =
  | { kind: 'single'; n: string }
  | { kind: 'range'; from: string; to: string }

function parseCiteParts(inner: string): CitePart[] {
  const parts: CitePart[] = []
  for (const raw of inner.split(/\s*,\s*/)) {
    const range = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(raw)
    if (range) {
      parts.push({ kind: 'range', from: range[1], to: range[2] })
      continue
    }
    if (/^\d+$/.test(raw)) parts.push({ kind: 'single', n: raw })
  }
  return parts
}

function expandCiteIds(parts: CitePart[]): string[] {
  const ids: string[] = []
  for (const part of parts) {
    if (part.kind === 'single') {
      ids.push(part.n)
      continue
    }
    const from = Number(part.from)
    const to = Number(part.to)
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    const lo = Math.min(from, to)
    const hi = Math.max(from, to)
    if (hi - lo > 50) {
      ids.push(String(lo), String(hi))
      continue
    }
    for (let n = lo; n <= hi; n++) ids.push(String(n))
  }
  return [...new Set(ids)]
}

function replaceCitations(text: string): string {
  return text.replace(CITE_RE, (full, nums: string) => {
    const ids = expandCiteIds(parseCiteParts(nums))
    if (ids.length === 0) return full
    return `<a href="#ref-${ids.join(',')}" class="md-cite" data-refs="${ids.join(',')}">${full}</a>`
  })
}

/** `#ref-2,3` / `#apa-miller-2021,apa-who-2022` → target ids. */
export function citeIdsFromHash(hash: string): string[] {
  const raw = decodeURIComponent(hash.replace(/^#/, '')).trim()
  const numeric = /^ref-(\d+(?:,\d+)*)$/.exec(raw)
  if (numeric) return numeric[1].split(',')
  if (raw.startsWith('apa-') || raw.includes(',apa-')) {
    return raw.split(',').map((part) => part.trim()).filter(Boolean)
  }
  return []
}

/**
 * `[1] Author. Title.` bibliography lines: keep each on its own line and give
 * the label a stable id so in-text citations can jump here.
 */
function formatRefLines(chunk: string): string {
  const lines = chunk.split('\n')
  const out: string[] = []
  let prevRef = false

  for (const line of lines) {
    const match = REF_LINE_RE.exec(line)
    if (!match) {
      out.push(line)
      prevRef = false
      continue
    }
    if (prevRef) out.push('')
    const [, indent, n, space, rest] = match
    out.push(
      `${indent}<span id="ref-${n}" class="md-ref-label">&#91;${n}&#93;</span>${space}${rest}`
    )
    prevRef = true
  }

  return out.join('\n')
}

/** Apply `fn` only outside fenced/inline code. */
export function mapOutsideCode(source: string, fn: (chunk: string) => string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const fence = source.startsWith('```', i)
      ? '```'
      : source.startsWith('~~~', i)
        ? '~~~'
        : null
    if (fence) {
      const close = source.indexOf(`\n${fence}`, i + 3)
      const end = close === -1 ? source.length : close + 1 + fence.length
      out += source.slice(i, end)
      i = end
      continue
    }
    if (source[i] === '`') {
      let ticks = 1
      while (source[i + ticks] === '`') ticks += 1
      const marker = '`'.repeat(ticks)
      const close = source.indexOf(marker, i + ticks)
      const end = close === -1 ? source.length : close + ticks
      out += source.slice(i, end)
      i = end
      continue
    }
    let j = i + 1
    while (
      j < source.length &&
      source[j] !== '`' &&
      !source.startsWith('```', j) &&
      !source.startsWith('~~~', j)
    ) {
      j += 1
    }
    out += fn(source.slice(i, j))
    i = j
  }
  return out
}

export function linkNumericCitations(source: string): string {
  return mapOutsideCode(source, (chunk) => replaceCitations(formatRefLines(chunk)))
}
