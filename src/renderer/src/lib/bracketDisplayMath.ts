export const BRACKET_DISPLAY_MATH_RE =
  /(?<![!$\\])\[\s*([^\]]+?)\s*\](?!\s*[\(\[])(?!\s*:)/g

export function looksLikeBracketDisplayMath(body: string): boolean {
  const t = body.trim()
  if (!t) return false
  if (/\\[a-zA-Z@]+/.test(t)) return true
  if (/[a-zA-Z]\s*<\s*[a-zA-Z]/.test(t)) return true
  if (/[=<>]/.test(t) && /[0-9]/.test(t) && /[a-zA-Z+\-*/^_{}\\]/.test(t)) {
    return true
  }
  return false
}

/** Rewrite model `[ … ]` display math; breaks onto its own block when mid-line. */
export function convertBracketDisplayMath(segment: string): string {
  return segment.replace(BRACKET_DISPLAY_MATH_RE, (match, body: string, offset: number) => {
    if (!looksLikeBracketDisplayMath(body)) return match
    const mathBlock = `$$\n${body.trim()}\n$$`
    const lineStart = segment.lastIndexOf('\n', offset - 1) + 1
    const beforeOnLine = segment.slice(lineStart, offset)
    if (beforeOnLine.trim().length > 0) {
      return `\n\n${mathBlock}`
    }
    return mathBlock
  })
}
