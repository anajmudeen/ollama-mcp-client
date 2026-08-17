import {
  Children,
  isValidElement,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode
} from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import 'katex/dist/katex.min.css'
import { normalizeMarkdown } from '../lib/normalizeMarkdown'
import { prepareLibraryReadme } from '../lib/prepareLibraryReadme'
import { rehypeKatexInHtml } from '../lib/rehypeKatexInHtml'
import { CodeBlock } from './CodeBlock'
import { MermaidDiagram } from './MermaidDiagram'

interface MarkdownContentProps {
  content: string
  streaming?: boolean
  /** Extra README HTML (center wrappers, classed divs). Chat still gets sanitized lists/etc. */
  allowHtml?: boolean
}

const htmlSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'center', 'font'],
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), 'className', 'class', 'align'],
    span: [...(defaultSchema.attributes?.span ?? []), 'className', 'class'],
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      'src',
      'alt',
      'title',
      'width',
      'height'
    ],
    a: [...(defaultSchema.attributes?.a ?? []), 'href', 'title', 'target', 'rel']
  }
}

const katexOptions = {
  throwOnError: false,
  strict: 'ignore' as const,
  errorColor: '#c5d0dc'
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

function parseSerializedFence(
  text: string
): { language: string; source: string } | null {
  const trimmed = text.replace(/\n$/, '')
  const match = /^([a-zA-Z][\w+-]*)(?:\\n|\n)([\s\S]+)$/.exec(trimmed)
  if (!match) return null
  const language = match[1]
  const source = match[2]
    .replace(/\\n/g, '\n')
    .replace(/\n```\s*$/, '')
    .replace(/\n$/, '')
  if (!source.includes('\n') && !/^[+\-!]/.test(source)) return null
  return { language, source }
}

function fencedCodeFromPre(
  children: ReactNode
): { language: string; source: string } | null {
  const child = Children.toArray(children)[0]
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    return null
  }
  const className = child.props.className ?? ''
  const match = /(?:^|\s)language-([^\s]+)/.exec(className)
  const source = String(child.props.children ?? '').replace(/\n$/, '')
  return { language: match?.[1] ?? '', source }
}

function markdownComponents(streaming?: boolean): Components {
  return {
    pre({ children }) {
      const fence = fencedCodeFromPre(children)
      if (fence?.language === 'mermaid') {
        return <MermaidDiagram source={fence.source} streaming={streaming} />
      }
      if (fence) {
        return <CodeBlock code={fence.source} language={fence.language} />
      }
      return <pre>{children}</pre>
    },
    code({ className, children }) {
      const text = String(children)
      if (!className) {
        const serialized = parseSerializedFence(text)
        if (serialized) {
          if (serialized.language === 'mermaid') {
            return (
              <MermaidDiagram source={serialized.source} streaming={streaming} />
            )
          }
          return (
            <CodeBlock
              code={serialized.source}
              language={serialized.language}
              compact
            />
          )
        }
      }
      return (
        <code className={className}>{children}</code>
      )
    },
    table({ children }) {
      return (
        <div className="md-table-wrap">
          <table>{children}</table>
        </div>
      )
    }
  }
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
  streaming,
  allowHtml
}: MarkdownContentProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)

  const components = useMemo(() => markdownComponents(streaming), [streaming])

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
  const prepared = allowHtml ? prepareLibraryReadme(forRender) : forRender
  const normalized = normalizeMarkdown(prepared)

  return (
    <div ref={rootRef} className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        components={components}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, htmlSanitizeSchema],
          [rehypeKatexInHtml, katexOptions],
          [rehypeKatex, katexOptions]
        ]}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  )
}
