import { useEffect, useState } from 'react'

interface CopyButtonProps {
  text: string
  className?: string
  label?: string
}

export function CopyButton({
  text,
  className = '',
  label = 'Copy'
}: CopyButtonProps): React.JSX.Element | null {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(id)
  }, [copied])

  if (!text.trim()) return null

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Fallback for restricted clipboard environments
      const el = document.createElement('textarea')
      el.value = text
      el.style.position = 'fixed'
      el.style.left = '-9999px'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
    }
  }

  return (
    <button
      type="button"
      title={copied ? 'Copied' : label}
      onClick={() => void onCopy()}
      className={`inline-flex items-center gap-1 rounded-md border border-[#2a3a4d] bg-[#0f1419]/80 px-1.5 py-0.5 text-[10px] text-[#8b9aab] backdrop-blur hover:border-[#3d5168] hover:text-[#e7ecf1] ${className}`}
    >
      {copied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M3.5 8.5 6.5 11.5 12.5 4.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect
              x="5.5"
              y="5.5"
              width="7"
              height="8"
              rx="1.2"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M3.5 10.5V3.8A1.3 1.3 0 0 1 4.8 2.5h5.7"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
          Copy
        </>
      )}
    </button>
  )
}
