import { useEffect, useState, type CSSProperties, type JSX } from 'react'
import type { ActivityPhase } from '../../../shared/types'

export interface ActivityState {
  phase: ActivityPhase
  detail?: string
  thinking?: string
  startedAt?: number
}

interface ActivityIndicatorProps {
  activity: ActivityState
  visible: boolean
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
  visible
}: ActivityIndicatorProps): JSX.Element | null {
  const [elapsed, setElapsed] = useState(0)
  const [thinkingOpen, setThinkingOpen] = useState(true)

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

  if (!visible || activity.phase === 'idle' || activity.phase === 'generating') {
    return null
  }

  const meta = PHASE_META[activity.phase]
  const hasThinking = Boolean(activity.thinking?.trim())
  const style = {
    '--activity-accent': meta.accent,
    '--activity-ring': meta.ring
  } as CSSProperties

  return (
    <div
      className="activity-enter mx-auto w-full max-w-2xl overflow-hidden rounded-xl border border-[#2a3a4d] bg-[#121820]"
      style={style}
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
                {meta.label}
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
            <div className="thinking-stream max-h-36 overflow-y-auto px-3.5 pb-3">
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[#9aa8b8]">
                {activity.thinking}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
