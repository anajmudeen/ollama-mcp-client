import { useLayoutEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { normalizeMarkdown } from '../lib/normalizeMarkdown'

interface MarkdownContentProps {
  content: string
  streaming?: boolean
}

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE
}

/** Visible text in a node, ignoring the streaming caret. */
function visibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\u200b/g, '')
  }
  if (!isElement(node) || node.classList.contains('stream-caret')) {
    return ''
  }
  let out = ''
  for (const child of node.childNodes) {
    out += visibleText(child)
  }
  return out
}

function hasVisibleText(node: Node): boolean {
  return visibleText(node).trim().length > 0
}

/**
 * Deepest node that still has real text — skip empty trailing blocks
 * (common while markdown streams `\n\n` before the next paragraph).
 */
function findCaretHost(root: HTMLElement): HTMLElement {
  const deepestWithText = (el: HTMLElement): HTMLElement => {
    for (
      let child: ChildNode | null = el.lastChild;
      child;
      child = child.previousSibling
    ) {
      if (isElement(child) && child.classList.contains('stream-caret')) {
        continue
      }
      if (child.nodeType === Node.TEXT_NODE) {
        if (hasVisibleText(child)) return el
        continue
      }
      if (isElement(child) && hasVisibleText(child)) {
        return deepestWithText(child)
      }
    }
    return el
  }

  // Prefer last root child that has text; never park on markdown-body itself
  // when that would place the caret on a new line after block elements.
  for (
    let child: ChildNode | null = root.lastChild;
    child;
    child = child.previousSibling
  ) {
    if (isElement(child) && child.classList.contains('stream-caret')) {
      continue
    }
    if (hasVisibleText(child)) {
      if (isElement(child)) return deepestWithText(child)
      return root
    }
  }

  return root
}

function syncStreamCaret(
  root: HTMLElement | null,
  streaming: boolean | undefined
): void {
  if (!root) return

  const existing = root.querySelector('.stream-caret')

  if (!streaming) {
    existing?.remove()
    return
  }

  const caret =
    existing instanceof HTMLElement
      ? existing
      : document.createElement('span')
  caret.className = 'stream-caret'
  caret.setAttribute('aria-hidden', 'true')

  const host = findCaretHost(root)
  // Avoid becoming a block sibling of paragraphs under .markdown-body
  if (host === root && root.querySelector('p, li, h1, h2, h3, h4, pre, td, th')) {
    const fallback = root.querySelector(
      'p:last-of-type, li:last-of-type, pre:last-of-type, h1:last-of-type, h2:last-of-type, h3:last-of-type, h4:last-of-type'
    )
    if (fallback instanceof HTMLElement) {
      fallback.appendChild(caret)
      return
    }
  }

  if (caret.parentElement !== host) {
    host.appendChild(caret)
  }
}

export function MarkdownContent({
  content,
  streaming
}: MarkdownContentProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    syncStreamCaret(rootRef.current, streaming)
  }, [content, streaming])

  if (!content) {
    return (
      <div ref={rootRef} className="inline text-[#8b9aab]">
        {/* caret attached in layout effect */}
      </div>
    )
  }

  // Trailing newlines create empty <p>s that park the caret on a blank line.
  const forRender = streaming ? content.replace(/\n+$/, '') : content
  const normalized = normalizeMarkdown(forRender)

  return (
    <div ref={rootRef} className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            {
              throwOnError: false,
              strict: 'ignore',
              errorColor: '#c5d0dc'
            }
          ]
        ]}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  )
}
