interface ToolCallCardProps {
  name: string
  arguments: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  result?: string
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
  result
}: ToolCallCardProps): React.JSX.Element {
  const argsJson = JSON.stringify(args, null, 2)
  const truncated =
    result && result.length > 4000 ? `${result.slice(0, 4000)}\n…` : result
  const shortName = name.includes('__') ? name.split('__').slice(1).join('__') : name

  return (
    <div
      className={`tool-card-enter mx-auto w-full max-w-2xl overflow-hidden rounded-lg border bg-[#141a22] ${
        status === 'running'
          ? 'tool-card-running border-[#3d5a40]'
          : status === 'error'
            ? 'border-rose-900/50'
            : 'border-[#2a3a4d]'
      }`}
    >
      <div className="px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
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
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-[#e7ecf1]">
                {shortName}
              </div>
              <div className="truncate font-mono text-[10px] text-[#6b7a8c]">{name}</div>
            </div>
          </div>
          <span className={`shrink-0 text-[10px] uppercase ${STATUS_COLOR[status]}`}>
            {STATUS_LABEL[status]}
          </span>
        </div>
        <pre className="mb-2 max-h-32 overflow-auto rounded bg-[#0f1419] p-2 font-mono text-[11px] leading-relaxed text-[#8b9aab]">
          {argsJson}
        </pre>
        {status === 'running' && (
          <div className="mb-2 h-1 overflow-hidden rounded-full bg-[#1a2430]">
            <div className="tool-progress-bar h-full rounded-full bg-emerald-500/70" />
          </div>
        )}
        {truncated !== undefined && (
          <pre className="max-h-48 overflow-auto rounded border border-[#243041] bg-[#0f1419] p-2 font-mono text-[11px] leading-relaxed text-[#c5d0dc]">
            {truncated}
          </pre>
        )}
      </div>
    </div>
  )
}
