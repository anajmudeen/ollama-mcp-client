import type { ElementContent, Root, Text } from 'hast'
import type { KatexOptions } from 'katex'
import { fromHtmlIsomorphic } from 'hast-util-from-html-isomorphic'
import katex from 'katex'
import { SKIP, visitParents } from 'unist-util-visit-parents'

const SKIP_TAGS = new Set(['code', 'pre', 'script', 'style', 'textarea', 'kbd', 'samp'])

type Piece =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string; display: boolean }

function isEscaped(source: string, index: number): boolean {
  let n = 0
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i--) n += 1
  return n % 2 === 1
}

function findUnescaped(source: string, from: number, delim: '$' | '$$'): number {
  const size = delim.length
  for (let i = from; i <= source.length - size; i++) {
    if (source.startsWith(delim, i) && !isEscaped(source, i)) {
      if (delim === '$' && source.startsWith('$$', i)) continue
      return i
    }
  }
  return -1
}

/** Split text on `$...$` / `$$...$$`, treating `\$` as a literal dollar. */
export function splitMathText(value: string): Piece[] {
  const out: Piece[] = []
  let i = 0
  let buf = ''
  const flush = (): void => {
    if (buf) {
      out.push({ kind: 'text', value: buf })
      buf = ''
    }
  }

  while (i < value.length) {
    if (value.startsWith('$$', i) && !isEscaped(value, i)) {
      const end = findUnescaped(value, i + 2, '$$')
      if (end === -1) {
        buf += value[i]
        i += 1
        continue
      }
      flush()
      out.push({ kind: 'math', display: true, value: value.slice(i + 2, end) })
      i = end + 2
      continue
    }
    if (value[i] === '$' && !isEscaped(value, i)) {
      const end = findUnescaped(value, i + 1, '$')
      if (end === -1) {
        buf += value[i]
        i += 1
        continue
      }
      flush()
      out.push({ kind: 'math', display: false, value: value.slice(i + 1, end) })
      i = end + 1
      continue
    }
    buf += value[i]
    i += 1
  }
  flush()
  return out.length > 0 ? out : [{ kind: 'text', value }]
}

function renderMath(
  tex: string,
  displayMode: boolean,
  options: KatexOptions
): ElementContent[] {
  try {
    const html = katex.renderToString(tex, {
      ...options,
      displayMode,
      throwOnError: false,
      strict: 'ignore'
    })
    const root = fromHtmlIsomorphic(html, { fragment: true })
    return root.children as ElementContent[]
  } catch {
    return [{ type: 'text', value: displayMode ? `$$${tex}$$` : `$${tex}$` }]
  }
}

/**
 * CommonMark does not parse `$math$` inside HTML blocks. After rehype-raw,
 * leftover delimiters sit in text nodes — render those with KaTeX.
 */
export function rehypeKatexInHtml(options: KatexOptions = {}) {
  return (tree: Root): undefined => {
    visitParents(tree, 'text', (node: Text, parents) => {
      if (
        parents.some(
          (p) => p.type === 'element' && SKIP_TAGS.has(p.tagName)
        )
      ) {
        return
      }
      const parent = parents[parents.length - 1]
      if (!parent || !('children' in parent)) return

      const pieces = splitMathText(node.value)
      if (pieces.length === 1 && pieces[0].kind === 'text') return

      const next: ElementContent[] = []
      for (const piece of pieces) {
        if (piece.kind === 'text') {
          if (piece.value) next.push({ type: 'text', value: piece.value })
          continue
        }
        next.push(...renderMath(piece.value, piece.display, options))
      }

      const index = parent.children.indexOf(node)
      if (index === -1) return
      parent.children.splice(index, 1, ...next)
      return SKIP
    })
  }
}
