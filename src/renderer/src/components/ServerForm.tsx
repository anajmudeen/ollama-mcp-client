import { useState } from 'react'
import type { CatalogInstallEnvHint, McpServerConfig } from '../../../shared/types'

interface ServerFormProps {
  initial: McpServerConfig | null
  onCancel: () => void
  onSave: (server: McpServerConfig) => void
  docsUrl?: string
  envHints?: CatalogInstallEnvHint[]
  hasInstallPreset?: boolean
  saving?: boolean
}

function Spinner({ className }: { className?: string }): React.JSX.Element {
  return (
    <span
      className={className}
      aria-hidden
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        border: '2px solid rgba(255, 255, 255, 0.25)',
        borderTopColor: '#fff',
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite'
      }}
    />
  )
}

function parseArgs(text: string): string[] {
  // Simple whitespace split; support quoted segments
  const args: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    args.push(m[1] ?? m[2] ?? m[3])
  }
  return args
}

function parseEnv(text: string): Record<string, string> | undefined {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return undefined
  const env: Record<string, string> = {}
  for (const line of lines) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return Object.keys(env).length ? env : undefined
}

export function ServerForm({
  initial,
  onCancel,
  onSave,
  docsUrl,
  envHints,
  hasInstallPreset,
  saving = false
}: ServerFormProps): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [command, setCommand] = useState(initial?.command ?? 'npx')
  const [argsText, setArgsText] = useState(
    initial?.args.join(' ') ??
      (hasInstallPreset
        ? ''
        : '-y @modelcontextprotocol/server-filesystem /tmp')
  )
  const [envText, setEnvText] = useState(
    initial?.env
      ? Object.entries(initial.env)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n')
      : ''
  )
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const noteHints = envHints?.filter((h) => h.name === 'NOTE') ?? []
  const keyHints = envHints?.filter((h) => h.name !== 'NOTE') ?? []

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (saving || !name.trim() || !command.trim()) return
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      command: command.trim(),
      args: parseArgs(argsText),
      env: parseEnv(envText),
      enabled
    })
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-lg border border-[#2a3a4d] bg-[#161d27] p-4 shadow-xl"
      >
        <h3 className="mb-3 text-base font-semibold text-[#f0f4f8]">
          {initial ? 'Edit MCP server' : 'Add MCP server'}
        </h3>
        {!hasInstallPreset && docsUrl ? (
          <p className="mb-3 text-xs leading-relaxed text-[#8b9aab]">
            No install preset yet — check the{' '}
            <a
              href={docsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[#7aa4d4] hover:underline"
            >
              project docs
            </a>{' '}
            for the command, then fill the fields below.
          </p>
        ) : null}
        {noteHints.length > 0 ? (
          <ul className="mb-3 list-disc space-y-1 pl-4 text-xs text-[#8b9aab]">
            {noteHints.map((h) => (
              <li key={h.description ?? h.name}>{h.description ?? h.name}</li>
            ))}
          </ul>
        ) : null}
        {keyHints.length > 0 ? (
          <p className="mb-3 text-xs text-[#8b9aab]">
            Fill required env vars:{' '}
            {keyHints
              .map((h) => `${h.name}${h.required ? '*' : ''}`)
              .join(', ')}
            .
          </p>
        ) : null}
        {docsUrl && hasInstallPreset ? (
          <p className="mb-3 text-xs text-[#8b9aab]">
            <a
              href={docsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[#7aa4d4] hover:underline"
            >
              Open docs
            </a>
          </p>
        ) : null}
        <label className="mb-1 block text-xs text-[#8b9aab]">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={saving}
          className="mb-3 w-full rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 text-sm outline-none focus:border-[#4a7ab0] disabled:opacity-60"
          placeholder="Filesystem"
          required
        />
        <label className="mb-1 block text-xs text-[#8b9aab]">Command</label>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="npx"
          required
          disabled={saving}
          className="mb-3 w-full rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 font-mono text-sm outline-none focus:border-[#4a7ab0] disabled:opacity-60"
        />
        <label className="mb-1 block text-xs text-[#8b9aab]">Arguments</label>
        <input
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
          disabled={saving}
          className="mb-3 w-full rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 font-mono text-sm outline-none focus:border-[#4a7ab0] disabled:opacity-60"
        />
        <label className="mb-1 block text-xs text-[#8b9aab]">
          Env (KEY=value per line)
        </label>
        <textarea
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
          rows={3}
          placeholder="API_KEY=..."
          disabled={saving}
          className="mb-3 w-full rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 font-mono text-sm outline-none focus:border-[#4a7ab0] disabled:opacity-60"
        />
        <label className="mb-4 flex items-center gap-2 text-sm text-[#c5d0dc]">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled
        </label>
        {saving ? (
          <p className="mb-3 flex items-start gap-2 rounded border border-[#2a3a4d] bg-[#0f1419] px-2.5 py-2 text-xs leading-relaxed text-[#8b9aab]">
            <span className="tool-spinner mt-0.5 shrink-0" />
            <span>
              Starting the server
              {enabled
                ? ' — first run may download the package (npx/uvx) and take a minute.'
                : '.'}
            </span>
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded border border-[#2a3a4d] px-3 py-1.5 text-sm text-[#c5d0dc] hover:bg-[#1a2430] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded bg-[#2d6cb5] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#3a7cc9] disabled:opacity-70"
          >
            {saving ? (
              <>
                <Spinner />
                Connecting…
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
