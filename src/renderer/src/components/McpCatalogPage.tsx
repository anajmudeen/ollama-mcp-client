import { useMemo, useState } from 'react'
import type {
  CatalogInstallEnvHint,
  CatalogServer,
  McpServerConfig
} from '../../../shared/types'
import {
  MCP_CATALOG,
  MCP_CATEGORIES,
  catalogToServerDraft,
  categoryLabel,
  isCatalogServerAdded
} from '../../../shared/mcp-catalog'
import { ServerForm } from './ServerForm'

interface McpCatalogPageProps {
  servers: Array<{ name: string }>
  onServerAdded: () => Promise<void> | void
}

const PAGE_SIZE = 24

export function McpCatalogPage({
  servers,
  onServerAdded
}: McpCatalogPageProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState<McpServerConfig | null>(null)
  const [draftMeta, setDraftMeta] = useState<{
    url?: string
    envHints?: CatalogInstallEnvHint[]
    hasInstall: boolean
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return MCP_CATALOG.filter((entry) => {
      if (category && entry.category !== category) return false
      if (!q) return true
      const hay = [
        entry.name,
        entry.description,
        entry.language ?? '',
        ...(entry.tags ?? [])
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [query, category])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  )

  const openAdd = (entry: CatalogServer): void => {
    setError(null)
    setDraft(catalogToServerDraft(entry))
    setDraftMeta({
      url: entry.url,
      envHints: entry.install?.envHints,
      hasInstall: Boolean(entry.install)
    })
  }

  const handleSave = async (server: McpServerConfig): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await window.api.mcp.upsertServer(server)
      setDraft(null)
      setDraftMeta(null)
      await onServerAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-[#243041] px-6 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#f0f4f8]">MCP Servers</h2>
            <p className="mt-0.5 text-sm text-[#8b9aab]">
              Browse categorized servers and add them to your workspace.
            </p>
          </div>
          <p className="text-xs text-[#6b7a8c]">
            {filtered.length} of {MCP_CATALOG.length} servers
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
            placeholder="Search name, description, or tags…"
            className="w-full max-w-md rounded-lg border border-[#2a3a4d] bg-[#0f1419] px-3 py-2 text-sm outline-none placeholder:text-[#5a6a7c] focus:border-[#4a7ab0]"
          />
          <div className="flex flex-wrap gap-1.5">
            <CategoryChip
              active={category === null}
              label="All"
              onClick={() => {
                setCategory(null)
                setPage(1)
              }}
            />
            {MCP_CATEGORIES.map((id) => (
              <CategoryChip
                key={id}
                active={category === id}
                label={categoryLabel(id)}
                onClick={() => {
                  setCategory(id)
                  setPage(1)
                }}
              />
            ))}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {error ? (
          <p className="mb-3 rounded-lg border border-rose-900/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        {pageItems.length === 0 ? (
          <p className="py-12 text-center text-sm text-[#6b7a8c]">
            No servers match your filters.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pageItems.map((entry) => {
              const added = isCatalogServerAdded(entry, servers)
              return (
                <li
                  key={entry.id}
                  className="flex flex-col rounded-lg border border-[#2a3a4d] bg-[#121820] p-4"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold leading-snug text-[#f0f4f8]">
                      {entry.name}
                    </h3>
                    {added ? (
                      <span className="shrink-0 rounded bg-emerald-950/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                        Added
                      </span>
                    ) : entry.install ? (
                      <span className="shrink-0 rounded bg-[#1a3050] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#9ec5f0]">
                        One-click
                      </span>
                    ) : null}
                  </div>
                  <p className="mb-3 line-clamp-3 flex-1 text-xs leading-relaxed text-[#8b9aab]">
                    {entry.description}
                  </p>
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    <span className="rounded border border-[#2a3a4d] px-1.5 py-0.5 text-[10px] text-[#7a8a9c]">
                      {categoryLabel(entry.category)}
                    </span>
                    {entry.language ? (
                      <span className="rounded border border-[#2a3a4d] px-1.5 py-0.5 text-[10px] text-[#7a8a9c]">
                        {entry.language}
                      </span>
                    ) : null}
                    {entry.official ? (
                      <span className="rounded border border-[#2a3a4d] px-1.5 py-0.5 text-[10px] text-[#7a8a9c]">
                        Official
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-auto flex items-center gap-2">
                    <button
                      type="button"
                      disabled={added || saving}
                      onClick={() => openAdd(entry)}
                      className="rounded bg-[#2d6cb5] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#3a7cc9] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {added ? 'Already added' : 'Add'}
                    </button>
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-[#2a3a4d] px-2.5 py-1.5 text-xs text-[#c5d0dc] hover:bg-[#1a2430]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Docs
                    </a>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {totalPages > 1 ? (
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-[#2a3a4d] px-3 py-1.5 text-xs text-[#c5d0dc] hover:bg-[#1a2430] disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-[#6b7a8c]">
              Page {safePage} of {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded border border-[#2a3a4d] px-3 py-1.5 text-xs text-[#c5d0dc] hover:bg-[#1a2430] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        ) : null}

        <footer className="mt-10 border-t border-[#243041] pt-4 pb-2 text-xs leading-relaxed text-[#6b7a8c]">
          Catalog adapted from{' '}
          <a
            href="https://github.com/mcpHQ/awesome-mcp-servers"
            target="_blank"
            rel="noreferrer"
            className="text-[#7aa4d4] hover:underline"
          >
            mcpHQ/awesome-mcp-servers
          </a>
          . Discover more on the{' '}
          <a
            href="https://registry.modelcontextprotocol.io"
            target="_blank"
            rel="noreferrer"
            className="text-[#7aa4d4] hover:underline"
          >
            official MCP Registry
          </a>{' '}
          and{' '}
          <a
            href="https://github.com/punkpeye/awesome-mcp-servers"
            target="_blank"
            rel="noreferrer"
            className="text-[#7aa4d4] hover:underline"
          >
            punkpeye/awesome-mcp-servers
          </a>
          . This app supports stdio servers (command/args/env) only — configure
          paths and API keys in the form before connecting in Settings.
        </footer>
      </div>

      {draft ? (
        <ServerForm
          initial={draft}
          docsUrl={draftMeta?.url}
          envHints={draftMeta?.envHints}
          hasInstallPreset={draftMeta?.hasInstall}
          onCancel={() => {
            setDraft(null)
            setDraftMeta(null)
          }}
          onSave={(server) => void handleSave(server)}
        />
      ) : null}
    </main>
  )
}

function CategoryChip({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
        active
          ? 'border-[#2d6cb5]/60 bg-[#1a3050] text-[#9ec5f0]'
          : 'border-[#2a3a4d] bg-[#0f1419] text-[#8b9aab] hover:bg-[#1a2430]'
      }`}
    >
      {label}
    </button>
  )
}
