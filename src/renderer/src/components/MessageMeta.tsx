import type { ReactNode } from 'react'
import { formatTokenCount } from '../../../shared/contextUsage'
import { contextUsageColor } from '../lib/contextUsage'

interface MessageMetaProps {
  createdAt?: string
  responseMs?: number
  tokensPerSec?: number
  model?: string
  contextUsed?: number
  contextLimit?: number
  align?: 'left' | 'right'
}

export function formatMessageTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  })
  if (sameDay) return time
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function formatResponseMs(ms?: number): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  const sec = ms / 1000
  if (sec < 60) return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}m ${s}s`
}

export function formatTokensPerSec(n?: number): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return ''
  const label = n >= 10 ? String(Math.round(n)) : n.toFixed(1)
  return `${label} tokens/sec`
}

export function MessageMeta({
  createdAt,
  responseMs,
  tokensPerSec,
  model,
  contextUsed,
  contextLimit,
  align = 'left'
}: MessageMetaProps): React.JSX.Element | null {
  const time = formatMessageTime(createdAt)
  const duration = formatResponseMs(responseMs)
  const speed = formatTokensPerSec(tokensPerSec)
  const modelLabel = model?.trim() || ''
  const hasContext =
    contextUsed != null &&
    contextLimit != null &&
    contextLimit > 0 &&
    contextUsed >= 0
  const pct = hasContext
    ? Math.max(0, (contextUsed / contextLimit) * 100)
    : 0
  const barPct = Math.min(100, pct)
  if (!time && !duration && !speed && !modelLabel && !hasContext) return null

  const parts: ReactNode[] = []
  const push = (node: ReactNode): void => {
    if (parts.length > 0) {
      parts.push(
        <span key={`dot-${parts.length}`} aria-hidden>
          ·
        </span>
      )
    }
    parts.push(node)
  }

  if (modelLabel) {
    push(
      <span
        key="model"
        title="Model"
        className="max-w-[14rem] truncate font-medium text-[#8b9aab]"
      >
        {modelLabel}
      </span>
    )
  }
  if (time) {
    push(<span key="time">{time}</span>)
  }
  if (duration) {
    push(
      <span key="duration" title="Response time" className="text-[#8b9aab]">
        {duration}
      </span>
    )
  }
  if (speed) {
    push(
      <span
        key="speed"
        title="Generation speed (tokens per second)"
        className="text-[#8b9aab]"
      >
        {speed}
      </span>
    )
  }
  if (hasContext) {
    const color = contextUsageColor(pct)
    push(
      <span
        key="context"
        title={`Context window when this reply finished: ${Math.round(contextUsed)} / ${Math.round(contextLimit)} tokens (${Math.round(pct)}%)`}
        className="inline-flex items-center gap-1.5 font-mono"
        style={{ color }}
      >
        <span
          className="inline-block h-1 w-8 overflow-hidden rounded-full bg-[#2a313a]"
          aria-hidden
        >
          <span
            className="block h-full rounded-full"
            style={{ width: `${barPct}%`, backgroundColor: color }}
          />
        </span>
        {formatTokenCount(contextUsed)} / {formatTokenCount(contextLimit)}
        <span className="text-[#6b7a8c]">({Math.round(pct)}%)</span>
      </span>
    )
  }

  return (
    <div
      className={`mt-1 flex flex-wrap items-center gap-1.5 text-[10px] tabular-nums text-[#6b7a8c] ${
        align === 'right' ? 'justify-end' : 'justify-start'
      }`}
    >
      {parts}
    </div>
  )
}
