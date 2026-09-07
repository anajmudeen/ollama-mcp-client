import { useSegmentTimer } from '../hooks/useSegmentTimer'

interface AssistantReplyTimerProps {
  active: boolean
  startedAt?: number
  durationMs?: number
}

export function AssistantReplyTimer({
  active,
  startedAt,
  durationMs
}: AssistantReplyTimerProps): React.JSX.Element | null {
  const label = useSegmentTimer({
    active,
    startedAt,
    durationMs
  })

  if (!label) return null

  return (
    <span
      className="pointer-events-none absolute right-2.5 top-2 z-10 font-mono text-[10px] tabular-nums text-[#6b7a8c]"
      title="Reply time"
    >
      {label}
    </span>
  )
}
