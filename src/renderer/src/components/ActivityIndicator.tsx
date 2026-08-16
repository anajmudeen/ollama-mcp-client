import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { ActivityPhase } from '../../../shared/types'
import { MarkdownContent } from './MarkdownContent'

export interface ActivityState {
  phase: ActivityPhase
  detail?: string
  thinking?: string
  startedAt?: number
}

interface ActivityIndicatorProps {
  activity: ActivityState
  visible: boolean
  /** When false, hide the live reasoning stream (still show phase). */
  showThinking?: boolean
}

const PHASE_META: Record<
  Exclude<ActivityPhase, 'idle'>,
  { label: string; accent: string; ring: string }
> = {
  thinking: {
    label: 'Thinking',
    accent: '#c4a35a',
    ring: 'rgba(196, 163, 90, 0.35)'
  },
  generating: {
    label: 'Generating',
    accent: '#6eb5ff',
    ring: 'rgba(110, 181, 255, 0.35)'
  },
  tool: {
    label: 'Using tools',
    accent: '#7dd3a8',
    ring: 'rgba(125, 211, 168, 0.35)'
  },
  synthesizing: {
    label: 'Synthesizing',
    accent: '#b39ddb',
    ring: 'rgba(179, 157, 219, 0.35)'
  }
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`
}

export function ActivityIndicator({
  activity,
  visible,
  showThinking = false
}: ActivityIndicatorProps): JSX.Element | null {
  const [elapsed, setElapsed] = useState(0)
  const [thinkingOpen, setThinkingOpen] = useState(true)
  const thinkingStreamRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!visible || !activity.startedAt) {
      setElapsed(0)
      return
    }
    const tick = (): void => {
      setElapsed(Date.now() - (activity.startedAt ?? Date.now()))
    }
    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [visible, activity.startedAt])

  useEffect(() => {
    if (activity.thinking) setThinkingOpen(true)
  }, [activity.thinking])

  useEffect(() => {
    if (!thinkingOpen) return
    const el = thinkingStreamRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [activity.thinking, thinkingOpen])

  if (!visible || activity.phase === 'idle') {
    return null
  }

  // Transcript ThinkingCard owns thinking once stream text exists.
  if (
    showThinking &&
    activity.phase === 'thinking' &&
    Boolean(activity.thinking?.trim())
  ) {
    return null
  }

  const meta = PHASE_META[activity.phase]
  const isImageGen =
    activity.phase === 'generating' &&
    (activity.detail ?? '').toLowerCase().includes('image')
  const hasThinking =
    Boolean(activity.thinking?.trim()) && activity.phase === 'thinking'
  const style = {
    '--activity-accent': isImageGen ? '#7ec8e3' : meta.accent,
    '--activity-ring': isImageGen
      ? 'rgba(126, 200, 227, 0.35)'
      : meta.ring
  } as CSSProperties

  return (
    <div
      className="activity-enter mr-auto w-full min-w-[16rem] max-w-[min(100%,42rem)] overflow-hidden rounded-xl border border-[#2a3a4d] bg-[#121820]"
      style={style}
      aria-live="polite"
      aria-busy="true"
    >
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
                {isImageGen ? 'Generating image' : meta.label}
              </span>
              <span className="activity-dots" aria-hidden="true">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-[#6b7a8c]">
                {formatElapsed(elapsed)}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-[#8b9aab]">
              {activity.detail ?? 'Working...'}
            </p>
          </div>
        </div>

        <div className="activity-progress mt-3 h-1 overflow-hidden rounded-full bg-[#1a2430]">
          <div className="activity-progress-bar h-full rounded-full" />
        </div>

        {isImageGen ? (
          <div
            className="image-gen-frame mt-3 overflow-hidden rounded-lg border border-[#243041] bg-[#0d1218]"
            aria-hidden="true"
          >
            <div className="image-gen-scan relative aspect-square w-full max-w-[14rem]">
              <div className="image-gen-grid absolute inset-0" />
              <div className="image-gen-beam absolute inset-x-0 h-1/3" />
            </div>
          </div>
        ) : null}
      </div>

      {hasThinking ? (
        <div className="border-t border-[#243041]">
          <button
            type="button"
            onClick={() => setThinkingOpen((o) => !o)}
            className="flex w-full items-center justify-between px-3.5 py-2 text-left text-[11px] uppercase tracking-wider text-[#8b9aab] hover:bg-[#1a2430]"
          >
            <span>Model reasoning</span>
            <span className="font-mono text-[#6b7a8c]">
              {thinkingOpen ? '-' : '+'}
            </span>
          </button>
          {thinkingOpen ? (
            <div
              ref={thinkingStreamRef}
              className="thinking-stream max-h-36 overflow-y-auto px-3.5 pb-3 text-[12px] leading-relaxed text-[#9aa8b8] [&_.markdown-body]:text-[#9aa8b8]"
            >
              <MarkdownContent content={activity.thinking ?? ''} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
