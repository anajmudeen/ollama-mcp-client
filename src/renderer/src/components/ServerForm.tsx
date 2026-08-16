import { useState } from 'react'
import type { CatalogInstallEnvHint, McpServerConfig } from '../../../shared/types'

interface ServerFormProps {
  initial: McpServerConfig | null
  onCancel: () => void
  onSave: (server: McpServerConfig) => void
  docsUrl?: string
  envHints?: CatalogInstallEnvHint[]
  hasInstallPreset?: boolean
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
  hasInstallPreset
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
    if (!name.trim() || !command.trim()) return
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
          className="mb-3 w-full rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 text-sm outline-none focus:border-[#4a7ab0]"
          placeholder="Filesystem"
          required
        />
        <label className="mb-1 block text-xs text-[#8b9aab]">Command</label>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          className="mb-3 w-full rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 font-mono text-sm outline-none focus:border-[#4a7ab0]"
          placeholder="npx"
          required
        />
        <label className="mb-1 block text-xs text-[#8b9aab]">Arguments</label>
        <input
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          className="mb-3 w-full rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 font-mono text-sm outline-none focus:border-[#4a7ab0]"
          placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
        />
        <label className="mb-1 block text-xs text-[#8b9aab]">
          Env (KEY=value per line)
        </label>
        <textarea
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
          rows={3}
          className="mb-3 w-full rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 font-mono text-sm outline-none focus:border-[#4a7ab0]"
          placeholder="API_KEY=..."
        />
        <label className="mb-4 flex items-center gap-2 text-sm text-[#c5d0dc]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-[#2a3a4d] px-3 py-1.5 text-sm text-[#c5d0dc] hover:bg-[#1a2430]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded bg-[#2d6cb5] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#3a7cc9]"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
