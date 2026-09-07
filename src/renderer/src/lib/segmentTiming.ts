import type { UiMessage } from '../../../shared/types'

type ThinkingMessage = Extract<UiMessage, { kind: 'thinking' }>
type ToolMessage = Extract<UiMessage, { kind: 'tool' }>

export function segmentDurationMs(
  startedAt?: number,
  now = Date.now()
): number | undefined {
  if (startedAt == null) return undefined
  return Math.max(0, now - startedAt)
}

export function elapsedSinceTurnMs(
  turnStartedAt?: number | null,
  now = Date.now()
): number | undefined {
  if (turnStartedAt == null) return undefined
  return Math.max(0, now - turnStartedAt)
}

export function closeThinkingMessage(
  msg: ThinkingMessage,
  turnStartedAt: number | null | undefined,
  now = Date.now()
): ThinkingMessage {
  return {
    ...msg,
    streaming: false,
    durationMs: segmentDurationMs(msg.startedAt, now),
    elapsedMs: elapsedSinceTurnMs(turnStartedAt, now)
  }
}

export function closeToolMessage(
  msg: ToolMessage,
  turnStartedAt: number | null | undefined,
  now = Date.now()
): ToolMessage {
  return {
    ...msg,
    durationMs: segmentDurationMs(msg.startedAt, now),
    elapsedMs: elapsedSinceTurnMs(turnStartedAt, now)
  }
}

export function closeStreamingThinking(
  messages: UiMessage[],
  turnStartedAt: number | null | undefined,
  now = Date.now()
): UiMessage[] {
  return messages.map((m) =>
    m.kind === 'thinking' && m.streaming
      ? closeThinkingMessage(m, turnStartedAt, now)
      : m
  )
}
