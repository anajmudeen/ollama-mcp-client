import { mapOutsideCode } from './linkNumericCitations'

/** `**Author, I.** (2021). Title…` bibliography entries. */
const APA_REF_LINE_RE =
  /^(\s*)\*\*(.+?)\*\*\s*\((\d{4}[a-z]?)\)\.(.*)$/

const PAREN_CITE_RE = /\((?=[^)]*\d{4})([^)]+)\)/g
const NARRATIVE_CITE_RE =
  /\b([A-Z][A-Za-z'.-]+(?:\s+and\s+[A-Z][A-Za-z'.-]+)?(?:\s+et\s+al\.)?)\s*\((\d{4}[a-z]?)\)/g

const PERSON_RE = /([A-Z][A-Za-z'-]+),\s*[A-Z]/g
const SKIP_WORDS = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'the'])

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bet\s+al\.?/g, '')
    .replace(/&/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function apaLastNames(author: string): string[] {
  const text = author.replace(/\.$/, '').trim()
  const names: string[] = []
  for (const chunk of text.split(/\s*&\s*/)) {
    PERSON_RE.lastIndex = 0
    const found: string[] = []
    let match: RegExpExecArray | null
    while ((match = PERSON_RE.exec(chunk))) found.push(match[1])
    if (found.length > 0) names.push(...found)
    else if (chunk.trim()) names.push(chunk.replace(/\.$/, '').trim())
  }
  return names
}

function acronymOf(name: string): string | null {
  const letters = name
    .split(/[\s,./]+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ''))
    .filter((w) => w.length > 0 && !SKIP_WORDS.has(w.toLowerCase()))
    .map((w) => w[0].toUpperCase())
    .join('')
  return letters.length >= 2 && letters.length <= 6 ? letters.toLowerCase() : null
}

function keysForNames(lastNames: string[], year: string): string[] {
  const keys = new Set<string>()
  if (lastNames.length === 0) return []
  const full = slugPart(lastNames.join(' '))
  const first = slugPart(lastNames[0])
  if (full) keys.add(`apa-${full}-${year}`)
  if (first) keys.add(`apa-${first}-${year}`)
  if (lastNames.length === 1) {
    const ac = acronymOf(lastNames[0])
    if (ac) keys.add(`apa-${ac}-${year}`)
  }
  return [...keys]
}

function canonicalId(lastNames: string[], year: string): string | null {
  if (lastNames.length === 0) return null
  if (lastNames.length >= 3) {
    const first = slugPart(lastNames[0])
    return first ? `apa-${first}-${year}` : null
  }
  const full = slugPart(lastNames.join(' '))
  return full ? `apa-${full}-${year}` : null
}

function collectApaRefs(chunk: string): Map<string, string> {
  const aliasToId = new Map<string, string>()
  for (const line of chunk.split('\n')) {
    const match = APA_REF_LINE_RE.exec(line)
    if (!match) continue
    const lastNames = apaLastNames(match[2])
    const year = match[3]
    const id = canonicalId(lastNames, year)
    if (!id) continue
    for (const key of keysForNames(lastNames, year)) {
      if (!aliasToId.has(key)) aliasToId.set(key, id)
    }
  }
  return aliasToId
}

function formatApaRefLines(chunk: string, refs: Map<string, string>): string {
  return chunk
    .split('\n')
    .map((line) => {
      const match = APA_REF_LINE_RE.exec(line)
      if (!match) return line
      const [, indent, author, year, rest] = match
      const id = canonicalId(apaLastNames(author), year)
      if (!id || ![...refs.values()].includes(id)) return line
      return `${indent}<span id="${id}" class="md-ref-label">**${author}**</span> (${year}).${rest}`
    })
    .join('\n')
}

function parseParenPart(raw: string): { author: string; year: string } | null {
  const cleaned = raw
    .trim()
    .replace(/^(?:e\.g\.|i\.e\.|see|cf\.|viz\.)[,:]?\s+/i, '')
  const match = /^(.+?),\s*(\d{4}[a-z]?)(?:,\s*.+)?$/.exec(cleaned)
  if (!match) return null
  const author = match[1].trim()
  if (!author || /^note\b/i.test(author)) return null
  return { author, year: match[2] }
}

function resolveCite(author: string, year: string, refs: Map<string, string>): string | null {
  const lastNames = author
    .replace(/\s+et\s+al\.?/i, '')
    .split(/\s*(?:&|and|,)\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
  for (const key of keysForNames(lastNames, year)) {
    const id = refs.get(key)
    if (id) return id
  }
  return refs.get(`apa-${slugPart(author)}-${year}`) ?? null
}

function citeAnchor(ids: string[], text: string): string {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return text
  const joined = unique.join(',')
  return `<a href="#${joined}" class="md-cite" data-refs="${joined}">${text}</a>`
}

function replaceParenthetical(text: string, refs: Map<string, string>): string {
  return text.replace(PAREN_CITE_RE, (full, inner: string) => {
    if (full.includes('class="md-cite"') || full.includes("class='md-cite'")) {
      return full
    }
    const ids: string[] = []
    for (const part of inner.split(/\s*;\s*/)) {
      const parsed = parseParenPart(part)
      if (!parsed) continue
      const id = resolveCite(parsed.author, parsed.year, refs)
      if (id) ids.push(id)
    }
    if (ids.length === 0) return full
    return citeAnchor(ids, full)
  })
}

function replaceNarrative(text: string, refs: Map<string, string>): string {
  return text.replace(NARRATIVE_CITE_RE, (full, author: string, year: string, offset: number) => {
    const before = text.slice(Math.max(0, offset - 20), offset)
    if (before.includes('<a ') || before.includes('id="apa-') || before.includes("id='apa-")) {
      return full
    }
    const id = resolveCite(author, year, refs)
    if (!id) return full
    return citeAnchor([id], full)
  })
}

export function linkApaCitations(source: string): string {
  const refs = new Map<string, string>()
  mapOutsideCode(source, (chunk) => {
    for (const [key, id] of collectApaRefs(chunk)) {
      if (!refs.has(key)) refs.set(key, id)
    }
    return chunk
  })
  if (refs.size === 0) return source
  return mapOutsideCode(source, (chunk) => {
    const withRefs = formatApaRefLines(chunk, refs)
    return replaceNarrative(replaceParenthetical(withRefs, refs), refs)
  })
}
