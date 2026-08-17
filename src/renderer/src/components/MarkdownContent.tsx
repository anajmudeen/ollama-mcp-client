import {
  Children,
  isValidElement,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import { citeIdsFromHash, linkNumericCitations } from '../lib/linkNumericCitations'
import { linkApaCitations } from '../lib/linkApaCitations'
import { rehypeKatexInHtml } from '../lib/rehypeKatexInHtml'
import { rehypeNumberedRefs } from '../lib/rehypeNumberedRefs'
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
    span: [...(defaultSchema.attributes?.span ?? []), 'className', 'class', 'id'],
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      'src',
      'alt',
      'title',
      'width',
      'height'
    ],
    a: [
      ...(defaultSchema.attributes?.a ?? []).filter(
        (item) => !(Array.isArray(item) && item[0] === 'className')
      ),
      'href',
      'title',
      'target',
      'rel',
      'id',
      'dataRefs',
      ['className', 'md-cite', 'data-footnote-backref']
    ],
    li: [...(defaultSchema.attributes?.li ?? []), 'id'],
    section: [
      ...(defaultSchema.attributes?.section ?? []),
      'id',
      'className',
      'class'
    ],
    h2: [...(defaultSchema.attributes?.h2 ?? []), 'id', 'className', 'class']
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

function textFromNode(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textFromNode).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textFromNode(node.props.children)
  }
  return ''
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function uniqueHeadingId(text: string, used: Map<string, number>): string {
  const base = slugify(text) || 'section'
  const n = used.get(base) ?? 0
  used.set(base, n + 1)
  return n === 0 ? base : `${base}-${n}`
}

function findAnchor(root: HTMLElement, hash: string): HTMLElement | null {
  const raw = decodeURIComponent(hash.replace(/^#/, '')).trim()
  if (!raw) return null
  const stripped = raw.replace(/^user-content-/, '')
  const ids = [...new Set([raw, stripped, `user-content-${stripped}`, `user-content-${raw}`])]
  for (const id of ids) {
    if (!id) continue
    const hit = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
    if (hit) return hit
  }

  const needle = stripped.toLowerCase().replace(/-/g, ' ')
  const headings = [
    ...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
  ]
  const slugHit = headings.find((h) => {
    const slug = (h.id || slugify(h.textContent ?? '')).toLowerCase()
    return slug === stripped.toLowerCase() || slug.includes(stripped.toLowerCase())
  })
  if (slugHit) return slugHit

  const textHits = headings.filter((h) =>
    (h.textContent ?? '').toLowerCase().includes(needle)
  )
  return textHits[0] ?? null
}

function findRefElement(root: HTMLElement, n: string): HTMLElement | null {
  const ids = /^\d+$/.test(n)
    ? [`ref-${n}`, `user-content-ref-${n}`]
    : [n, `user-content-${n}`]
  const nodes = [
    ...root.querySelectorAll<HTMLElement>(
      ids.map((id) => `#${CSS.escape(id)}`).join(', ')
    )
  ]
  if (nodes.length === 0) return null
  return (
    nodes.find((el) => el.classList.contains('md-ref-label')) ??
    nodes.find((el) => el.closest('p')?.querySelector('.md-ref-label')) ??
    nodes[0]
  )
}

function applyCiteHighlights(root: HTMLElement, ids: string[]): HTMLElement[] {
  root.querySelectorAll('.md-cite-target').forEach((el) => {
    el.classList.remove('md-cite-target')
  })
  const targets: HTMLElement[] = []
  for (const id of ids) {
    const node = findRefElement(root, id)
    if (!node) continue
    node.classList.add('md-cite-target')
    const block = node.closest('p, li')
    if (block instanceof HTMLElement) {
      block.classList.add('md-cite-target')
      targets.push(block)
    } else {
      targets.push(node)
    }
  }
  return targets
}

function scrollToAnchor(
  root: HTMLElement | null,
  hash: string,
  setCiteTargets: (ids: string[]) => void
): boolean {
  if (!root) return false
  const citeIds = citeIdsFromHash(hash)
  if (citeIds.length > 0) {
    setCiteTargets(citeIds)
    const targets = applyCiteHighlights(root, citeIds)
    if (targets.length === 0) return false
    targets[0].scrollIntoView({ behavior: 'smooth', block: 'start' })
    return true
  }
  setCiteTargets([])
  const target = findAnchor(root, hash)
  if (!target) return false
  applyCiteHighlights(root, [])
  target.classList.add('md-cite-target')
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return true
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

function markdownComponents(
  streaming: boolean | undefined,
  rootRef: { current: HTMLDivElement | null },
  setCiteTargets: (ids: string[]) => void
): Components {
  const usedIds = new Map<string, number>()
  const heading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
    function Heading({
      children,
      id,
      className
    }: {
      children?: ReactNode
      id?: string
      className?: string
    }): React.JSX.Element {
      const nextId = id || uniqueHeadingId(textFromNode(children), usedIds)
      return (
        <Tag id={nextId} className={className}>
          {children}
        </Tag>
      )
    }

  return {
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    h4: heading('h4'),
    h5: heading('h5'),
    h6: heading('h6'),
    a({ href, children, id, className, ...rest }) {
      const dataRefs =
        typeof (rest as { dataRefs?: unknown }).dataRefs === 'string'
          ? (rest as { dataRefs: string }).dataRefs
          : undefined
      if (href?.startsWith('#')) {
        const hash =
          dataRefs && /^\d+(,\d+)*$/.test(dataRefs)
            ? `#ref-${dataRefs}`
            : dataRefs
              ? `#${dataRefs}`
              : href
        return (
          <a
            href={hash}
            id={id}
            className={className}
            onClick={(e) => {
              e.preventDefault()
              scrollToAnchor(rootRef.current, hash, setCiteTargets)
            }}
          >
            {children}
          </a>
        )
      }
      return (
        <a href={href} id={id} className={className} target="_blank" rel="noreferrer">
          {children}
        </a>
      )
    },
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
    li({ children, id, className }) {
      return (
        <li id={id} className={className}>
          {children}
        </li>
      )
    },
    section({ children, id, className }) {
      return (
        <section id={id} className={className}>
          {children}
        </section>
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
  const [citeTargets, setCiteTargets] = useState<string[]>([])

  const components = useMemo(
    () => markdownComponents(streaming, rootRef, setCiteTargets),
    [streaming]
  )

  useLayoutEffect(() => {
    syncStreamCaret(rootRef.current, streaming)
    if (citeTargets.length > 0 && rootRef.current) {
      applyCiteHighlights(rootRef.current, citeTargets)
    }
  }, [content, streaming, citeTargets])

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
  const normalized = linkApaCitations(
    linkNumericCitations(normalizeMarkdown(prepared))
  )

  return (
    <div ref={rootRef} className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        components={components}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, htmlSanitizeSchema],
          rehypeNumberedRefs,
          [rehypeKatexInHtml, katexOptions],
          [rehypeKatex, katexOptions]
        ]}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  )
}
