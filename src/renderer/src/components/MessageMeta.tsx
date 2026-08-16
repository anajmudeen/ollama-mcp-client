interface MessageMetaProps {
  createdAt?: string
  responseMs?: number
  model?: string
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

export function MessageMeta({
  createdAt,
  responseMs,
  model,
  align = 'left'
}: MessageMetaProps): React.JSX.Element | null {
  const time = formatMessageTime(createdAt)
  const duration = formatResponseMs(responseMs)
  const modelLabel = model?.trim() || ''
  if (!time && !duration && !modelLabel) return null

  return (
    <div
      className={`mt-1 flex flex-wrap items-center gap-1.5 text-[10px] tabular-nums text-[#6b7a8c] ${
        align === 'right' ? 'justify-end' : 'justify-start'
      }`}
    >
      {modelLabel ? (
        <span title="Model" className="max-w-[14rem] truncate font-medium text-[#8b9aab]">
          {modelLabel}
        </span>
      ) : null}
      {modelLabel && time ? <span aria-hidden>·</span> : null}
      {time ? <span>{time}</span> : null}
      {(modelLabel || time) && duration ? <span aria-hidden>·</span> : null}
      {duration ? (
        <span title="Response time" className="text-[#8b9aab]">
          {duration}
        </span>
      ) : null}
    </div>
  )
}
