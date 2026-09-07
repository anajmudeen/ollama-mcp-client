import { useEffect, useState } from 'react'
import { formatResponseMs } from '../components/MessageMeta'

interface UseSegmentTimerOptions {
  active: boolean
  startedAt?: number
  durationMs?: number
}

export function useSegmentTimer({
  active,
  startedAt,
  durationMs
}: UseSegmentTimerOptions): string {
  const [liveMs, setLiveMs] = useState(0)

  useEffect(() => {
    if (!active || startedAt == null) {
      setLiveMs(0)
      return
    }
    const tick = (): void => {
      setLiveMs(Date.now() - startedAt)
    }
    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [active, startedAt])

  if (active && startedAt != null) {
    return formatResponseMs(liveMs)
  }
  return formatResponseMs(durationMs)
}
