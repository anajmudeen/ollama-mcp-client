import { useState } from 'react'
import { MessageMeta } from './MessageMeta'

interface ToolCallCardProps {
  name: string
  arguments: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  result?: string
  createdAt?: string
}

const STATUS_LABEL = {
  running: 'Running',
  done: 'Done',
  error: 'Error'
} as const

const STATUS_COLOR = {
  running: 'text-amber-300',
  done: 'text-emerald-400',
  error: 'text-rose-300'
} as const

export function ToolCallCard({
  name,
  arguments: args,
  status,
  result,
  createdAt
}: ToolCallCardProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const argsJson = JSON.stringify(args, null, 2)
  const truncated =
    result && result.length > 4000 ? `${result.slice(0, 4000)}\n…` : result
  const shortName = name.includes('__') ? name.split('__').slice(1).join('__') : name

  return (
    <div className="tool-card-enter mr-auto w-full min-w-[16rem] max-w-[min(100%,42rem)]">
      <div
        className={`overflow-hidden rounded-lg border bg-[#141a22] ${
          status === 'running'
            ? 'tool-card-running border-[#3d5a40]'
            : status === 'error'
              ? 'border-rose-900/50'
              : 'border-[#2a3a4d]'
        }`}
      >
        <div className="px-3 py-2.5">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <div className="flex min-w-0 items-center gap-2">
              {status === 'running' ? (
                <span className="tool-spinner shrink-0" aria-hidden />
              ) : status === 'done' ? (
                <span className="tool-check shrink-0 text-emerald-400" aria-hidden>
                  ✓
                </span>
              ) : (
                <span className="shrink-0 text-rose-300" aria-hidden>
                  !
                </span>
              )}
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#e7ecf1]">
                Tool call
              </span>
              <span className="truncate text-[11px] text-[#6b7a8c]">{shortName}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`text-[10px] uppercase ${STATUS_COLOR[status]}`}>
                {STATUS_LABEL[status]}
              </span>
              <span className="font-mono text-[11px] text-[#6b7a8c]">
                {open ? '−' : '+'}
              </span>
            </div>
          </button>

          {status === 'running' && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#1a2430]">
              <div className="tool-progress-bar h-full rounded-full bg-emerald-500/70" />
            </div>
          )}

          {open && (
            <div className="mt-2 space-y-2 border-t border-[#243041] pt-2">
              <div className="min-w-0 rounded bg-[#0f1419] px-2 py-1.5">
                <div className="truncate text-xs font-medium text-[#e7ecf1]">
                  {shortName}
                </div>
                <div className="truncate font-mono text-[10px] text-[#6b7a8c]">
                  {name}
                </div>
              </div>
              <pre className="max-h-32 overflow-auto rounded bg-[#0f1419] p-2 font-mono text-[11px] leading-relaxed text-[#8b9aab]">
                {argsJson}
              </pre>
              {truncated !== undefined && (
                <pre className="max-h-48 overflow-auto rounded border border-[#243041] bg-[#0f1419] p-2 font-mono text-[11px] leading-relaxed text-[#c5d0dc]">
                  {truncated}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
      <MessageMeta createdAt={createdAt} align="left" />
    </div>
  )
}
