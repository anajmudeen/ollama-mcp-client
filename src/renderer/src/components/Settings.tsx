import { useEffect, useRef, useState } from 'react'
import type { McpServerConfig, McpToolInfo } from '../../../shared/types'
import type { ServerWithStatus } from '../../../preload/index'
import { ServerForm } from './ServerForm'

interface SettingsProps {
  open: boolean
  onClose: () => void
  servers: ServerWithStatus[]
  tools: McpToolInfo[]
  ollamaOk: boolean
  ollamaError?: string
  baseUrl: string
  onRefreshServers: () => void
  onRefreshOllama: () => void
  onSetBaseUrl: (url: string) => void
}

interface ToolTooltipState {
  serverId: string
  top: number
  left: number
  width: number
}

export function Settings({
  open,
  onClose,
  servers,
  tools,
  ollamaOk,
  ollamaError,
  baseUrl,
  onRefreshServers,
  onRefreshOllama,
  onSetBaseUrl
}: SettingsProps): React.JSX.Element | null {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<McpServerConfig | null>(null)
  const [urlDraft, setUrlDraft] = useState(baseUrl)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toolTip, setToolTip] = useState<ToolTooltipState | null>(null)
  const tipHideTimer = useRef<number | null>(null)

  useEffect(() => {
    setUrlDraft(baseUrl)
  }, [baseUrl])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !showForm) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, showForm, onClose])

  if (!open) return null

  const clearTipHide = (): void => {
    if (tipHideTimer.current !== null) {
      window.clearTimeout(tipHideTimer.current)
      tipHideTimer.current = null
    }
  }

  const showToolsTip = (
    serverId: string,
    el: HTMLElement,
    hasTools: boolean
  ): void => {
    if (!hasTools) return
    clearTipHide()
    const rect = el.getBoundingClientRect()
    setToolTip({
      serverId,
      top: rect.bottom + 6,
      left: rect.left,
      width: Math.max(rect.width, 220)
    })
  }

  const scheduleHideToolsTip = (): void => {
    clearTipHide()
    tipHideTimer.current = window.setTimeout(() => {
      setToolTip(null)
    }, 120)
  }

  const openAdd = (): void => {
    setEditing(null)
    setShowForm(true)
  }

  const openEdit = (server: McpServerConfig): void => {
    setEditing(server)
    setShowForm(true)
  }

  const handleSave = async (server: McpServerConfig): Promise<void> => {
    setError(null)
    try {
      await window.api.mcp.upsertServer(server)
      setShowForm(false)
      setEditing(null)
      onRefreshServers()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleConnect = async (id: string): Promise<void> => {
    setBusyId(id)
    setError(null)
    try {
      await window.api.mcp.connect(id)
      onRefreshServers()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const handleDisconnect = async (id: string): Promise<void> => {
    setBusyId(id)
    setError(null)
    try {
      await window.api.mcp.disconnect(id)
      onRefreshServers()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const handleRemove = async (id: string): Promise<void> => {
    setBusyId(id)
    setError(null)
    try {
      await window.api.mcp.removeServer(id)
      onRefreshServers()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !showForm) onClose()
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[#2a3a4d] bg-[#161d27] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#243041] px-4 py-3">
          <h2 className="text-base font-semibold text-[#f0f4f8]">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[#2a3a4d] px-2.5 py-1 text-xs text-[#c5d0dc] hover:bg-[#1a2430]"
          >
            Close
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4">
          <section className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8b9aab]">
                Ollama
              </h3>
              <button
                type="button"
                onClick={onRefreshOllama}
                className="text-xs text-[#6eb5ff] hover:underline"
              >
                Refresh
              </button>
            </div>
            <div className="mb-2 flex items-center gap-2 text-sm">
              <span
                className={`inline-block h-2 w-2 rounded-full ${ollamaOk ? 'bg-emerald-400' : 'bg-rose-400'}`}
              />
              <span className="text-[#c5d0dc]">
                {ollamaOk ? 'Connected' : 'Offline'}
              </span>
            </div>
            {!ollamaOk && ollamaError && (
              <p className="mb-2 text-xs text-rose-300">{ollamaError}</p>
            )}
            <label className="mb-1 block text-xs text-[#8b9aab]">Base URL</label>
            <div className="flex gap-1">
              <input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onBlur={() => {
                  if (urlDraft !== baseUrl) onSetBaseUrl(urlDraft)
                }}
                className="min-w-0 flex-1 rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 text-xs text-[#e7ecf1] outline-none focus:border-[#4a7ab0]"
              />
              <button
                type="button"
                onClick={() => onSetBaseUrl(urlDraft)}
                className="rounded border border-[#2a3a4d] px-2 text-xs text-[#c5d0dc] hover:bg-[#1a2430]"
              >
                Save
              </button>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8b9aab]">
                MCP Servers
              </h3>
              <button
                type="button"
                onClick={openAdd}
                className="text-xs text-[#6eb5ff] hover:underline"
              >
                + Add
              </button>
            </div>
            <p className="mb-2 text-xs text-[#6b7a8c]">
              {tools.length} tool{tools.length === 1 ? '' : 's'} available
            </p>
            {error && (
              <p className="mb-2 rounded border border-rose-900/50 bg-rose-950/40 px-2 py-1.5 text-xs text-rose-200">
                {error}
              </p>
            )}
            <ul className="space-y-2">
              {servers.length === 0 && (
                <li className="text-xs text-[#6b7a8c]">No servers configured.</li>
              )}
              {servers.map((server) => {
                const serverTools = tools.filter((t) => t.serverId === server.id)
                const hasTools = server.connected && serverTools.length > 0

                return (
                  <li
                    key={server.id}
                    className="rounded border border-[#2a3a4d] bg-[#0f1419] p-2.5"
                    onMouseEnter={(e) =>
                      showToolsTip(server.id, e.currentTarget, hasTools)
                    }
                    onMouseLeave={scheduleHideToolsTip}
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 truncate text-sm font-medium text-[#e7ecf1]">
                          <span className="truncate">{server.name}</span>
                          {hasTools && (
                            <span className="shrink-0 rounded bg-[#1a3050] px-1.5 py-0.5 text-[10px] font-normal text-[#9ec5f0]">
                              {serverTools.length} tool
                              {serverTools.length === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                        <div className="truncate font-mono text-[10px] text-[#6b7a8c]">
                          {server.command} {server.args.join(' ')}
                        </div>
                      </div>
                      <span
                        className={`mt-0.5 shrink-0 text-[10px] uppercase ${server.connected ? 'text-emerald-400' : 'text-[#6b7a8c]'}`}
                      >
                        {server.connected ? 'on' : 'off'}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1">
                      {server.connected ? (
                        <button
                          type="button"
                          disabled={busyId === server.id}
                          onClick={() => void handleDisconnect(server.id)}
                          className="rounded border border-[#2a3a4d] px-2 py-0.5 text-[11px] text-[#c5d0dc] hover:bg-[#1a2430] disabled:opacity-50"
                        >
                          Disconnect
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === server.id}
                          onClick={() => void handleConnect(server.id)}
                          className="rounded border border-[#3d6a9a] bg-[#1a3050] px-2 py-0.5 text-[11px] text-[#9ec5f0] hover:bg-[#234068] disabled:opacity-50"
                        >
                          Connect
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEdit(server)}
                        className="rounded border border-[#2a3a4d] px-2 py-0.5 text-[11px] text-[#c5d0dc] hover:bg-[#1a2430]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busyId === server.id}
                        onClick={() => void handleRemove(server.id)}
                        className="rounded border border-[#4a3030] px-2 py-0.5 text-[11px] text-rose-300 hover:bg-[#2a1818] disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        </div>
      </div>

      {toolTip && (
        <div
          role="tooltip"
          className="fixed z-50 max-h-48 overflow-y-auto rounded-md border border-[#2a3a4d] bg-[#161d27] p-2 shadow-xl"
          style={{
            top: toolTip.top,
            left: toolTip.left,
            width: toolTip.width
          }}
          onMouseEnter={clearTipHide}
          onMouseLeave={scheduleHideToolsTip}
        >
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#6b7a8c]">
            Tools
          </div>
          <ul className="space-y-1.5">
            {tools
              .filter((t) => t.serverId === toolTip.serverId)
              .map((t) => (
                <li
                  key={t.prefixedName}
                  className="font-mono text-[10px] leading-snug text-[#c5d0dc]"
                >
                  <span className="text-[#9ec5f0]">{t.name}</span>
                  {t.description ? (
                    <span className="mt-0.5 block text-[#6b7a8c]">
                      {t.description}
                    </span>
                  ) : null}
                </li>
              ))}
          </ul>
        </div>
      )}

      {showForm && (
        <ServerForm
          initial={editing}
          onCancel={() => {
            setShowForm(false)
            setEditing(null)
          }}
          onSave={(s) => void handleSave(s)}
        />
      )}
    </div>
  )
}
