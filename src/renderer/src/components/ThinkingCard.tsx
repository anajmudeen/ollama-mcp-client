import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { MarkdownContent } from './MarkdownContent'
import { MessageMeta } from './MessageMeta'

interface ThinkingCardProps {
  content: string
  streaming?: boolean
  startedAt?: number
  createdAt?: string
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`
}

export function ThinkingCard({
  content,
  streaming,
  startedAt,
  createdAt
}: ThinkingCardProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const streamRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!streaming || !startedAt) {
      setElapsed(0)
      return
    }
    const tick = (): void => {
      setElapsed(Date.now() - startedAt)
    }
    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [streaming, startedAt])

  useEffect(() => {
    if (!streaming && !open) return
    const el = streamRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [content, streaming, open])

  const style = {
    '--activity-accent': '#c4a35a',
    '--activity-ring': 'rgba(196, 163, 90, 0.35)'
  } as CSSProperties

  return (
    <div className="msg-enter mr-auto w-full min-w-[16rem] max-w-[min(100%,42rem)]">
      <div
        className="overflow-hidden rounded-xl border border-[#2a3a4d] bg-[#121820] text-left"
        style={streaming ? style : undefined}
      >
        {streaming ? (
          <div className="activity-shimmer relative px-3.5 py-3">
            <div className="flex items-center gap-3">
              <div className="activity-orb relative h-9 w-9 shrink-0">
                <span className="activity-orb-core absolute inset-1.5 rounded-full" />
                <span className="activity-orb-ring absolute inset-0 rounded-full" />
                <span className="activity-orb-ring activity-orb-ring-delay absolute inset-0 rounded-full" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium tracking-wide text-[#f0f4f8]">
                    Thinking
                  </span>
                  <span className="activity-dots" aria-hidden="true">
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                  </span>
                  {startedAt ? (
                    <span className="ml-auto font-mono text-[11px] tabular-nums text-[#6b7a8c]">
                      {formatElapsed(elapsed)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-xs text-[#8b9aab]">
                  Model is reasoning…
                </p>
              </div>
            </div>
            <div className="activity-progress mt-3 h-1 overflow-hidden rounded-full bg-[#1a2430]">
              <div className="activity-progress-bar h-full rounded-full" />
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-between px-3.5 py-2 text-left hover:bg-[#1a2430]"
          >
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#8b9aab]">
              Model thinking
            </span>
            <span className="font-mono text-[11px] text-[#6b7a8c]">
              {open ? '−' : '+'}
            </span>
          </button>
        )}

        {(streaming || open) && (
          <div
            ref={streamRef}
            className="thinking-stream max-h-48 overflow-y-auto border-t border-[#243041] px-3.5 py-2.5 text-[12px] leading-relaxed text-[#9aa8b8] [&_.markdown-body]:text-[#9aa8b8] [&_.markdown-body_strong]:text-[#c5d0dc] [&_.markdown-body_h1]:text-sm [&_.markdown-body_h2]:text-sm [&_.markdown-body_h3]:text-[13px]"
          >
            <MarkdownContent content={content} streaming={streaming} />
          </div>
        )}
      </div>
      <MessageMeta createdAt={createdAt} align="left" />
    </div>
  )
}
