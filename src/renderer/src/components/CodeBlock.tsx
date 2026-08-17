import { useMemo } from 'react'
import hljs from 'highlight.js/lib/common'
import { CopyButton } from './CopyButton'

interface CodeBlockProps {
  code: string
  language?: string
  compact?: boolean
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function highlightDiff(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      const escaped = escapeHtml(line)
      if (line.startsWith('+')) {
        return `<span class="hljs-addition">${escaped}</span>`
      }
      if (line.startsWith('-')) {
        return `<span class="hljs-deletion">${escaped}</span>`
      }
      if (line.startsWith('!')) {
        return `<span class="hljs-change">${escaped}</span>`
      }
      if (
        line.startsWith('@@') ||
        line.startsWith('diff ') ||
        line.startsWith('index ')
      ) {
        return `<span class="hljs-meta">${escaped}</span>`
      }
      return escaped
    })
    .join('')
}

function highlightCode(code: string, language?: string): string {
  const lang = language?.trim().toLowerCase()
  if (lang === 'diff' || lang === 'patch') {
    return highlightDiff(code)
  }
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch {
      // fall through to escaped text
    }
  }
  return escapeHtml(code)
}

export function CodeBlock({
  code,
  language,
  compact
}: CodeBlockProps): React.JSX.Element {
  const html = useMemo(() => highlightCode(code, language), [code, language])
  const label = language?.trim().toLowerCase()

  return (
    <div className={compact ? 'md-code-block md-code-block-compact' : 'md-code-block'}>
      {compact ? null : (
        <div className="md-code-header">
          <span className="md-code-lang">{label || 'code'}</span>
          <CopyButton text={code} />
        </div>
      )}
      <pre>
        <code
          className={label ? `hljs language-${label}` : 'hljs'}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </div>
  )
}
