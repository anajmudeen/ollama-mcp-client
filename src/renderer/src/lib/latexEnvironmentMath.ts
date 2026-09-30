/** `array`, `matrix`, `cases`, etc. — column spec is optional (`{c|c}` for array). */
const LATEX_ENV_BLOCK_RE =
  /\\begin\{([a-zA-Z*]+)\}(\{[^}]*\})?([\s\S]*?)\\end\{\1\}/g

function isInsideDisplayMath(source: string, offset: number): boolean {
  let i = 0
  let inDisplay = false
  while (i < offset) {
    if (source.startsWith('$$', i) && !isEscaped(source, i)) {
      inDisplay = !inDisplay
      i += 2
      continue
    }
    i += 1
  }
  return inDisplay
}

function isEscaped(source: string, index: number): boolean {
  let n = 0
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i--) n += 1
  return n % 2 === 1
}

/**
 * Models often emit a single `\` + space instead of `\\` between array rows.
 */
export function fixLatexRowBreaks(tex: string): string {
  return tex.replace(
    /\\begin\{array\}(\{[^}]*\})?([\s\S]*?)\\end\{array\}/g,
    (_full, cols: string | undefined, inner: string) => {
      const fixedInner = inner
        .replace(/(?<!\\)\\[ \t]+(?=\\hline)/g, '\\\\\n')
        .replace(/(?<!\\)\\[ \t]+(?=\()/g, '\\\\\n')
      return `\\begin{array}${cols ?? ''}${fixedInner}\\end{array}`
    }
  )
}

/** Wrap `\begin{…}…\end{…}` blocks in `$$` when not already in display math. */
export function wrapBareLatexEnvironments(segment: string): string {
  return segment.replace(
    LATEX_ENV_BLOCK_RE,
    (match, _env: string, _cols: string | undefined, _body: string, offset: number) => {
      if (isInsideDisplayMath(segment, offset)) return fixLatexRowBreaks(match)
      const fixed = fixLatexRowBreaks(match)
      const lineStart = segment.lastIndexOf('\n', offset - 1) + 1
      const beforeOnLine = segment.slice(lineStart, offset)
      const prefix = beforeOnLine.trim().length > 0 ? '\n\n' : '\n'
      return `${prefix}$$\n${fixed.trim()}\n$$\n`
    }
  )
}
