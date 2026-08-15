import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownContentProps {
  content: string
  streaming?: boolean
}

export function MarkdownContent({
  content,
  streaming
}: MarkdownContentProps): React.JSX.Element {
  if (!content) {
    return (
      <span className="text-[#8b9aab]">
        {streaming ? '…' : ''}
        {streaming && (
          <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-[#6eb5ff]" />
        )}
      </span>
    )
  }

  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      {streaming && (
        <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-[#6eb5ff] align-middle" />
      )}
    </div>
  )
}
