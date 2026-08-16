import { useEffect, useState } from 'react'

interface SettingsProps {
  open: boolean
  onClose: () => void
  ollamaOk: boolean
  ollamaError?: string
  baseUrl: string
  showThinking: boolean
  onRefreshOllama: () => void
  onSetBaseUrl: (url: string) => void
  onSetShowThinking: (enabled: boolean) => void
}

export function Settings({
  open,
  onClose,
  ollamaOk,
  ollamaError,
  baseUrl,
  showThinking,
  onRefreshOllama,
  onSetBaseUrl,
  onSetShowThinking
}: SettingsProps): React.JSX.Element | null {
  const [urlDraft, setUrlDraft] = useState(baseUrl)

  useEffect(() => {
    setUrlDraft(baseUrl)
  }, [baseUrl])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
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
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#8b9aab]">
              Chat
            </h3>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#2a3a4d] bg-[#0f1419] px-3 py-2.5">
              <input
                type="checkbox"
                checked={Boolean(showThinking)}
                onChange={(e) => onSetShowThinking(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#2a3a4d] bg-[#161d27] text-[#2d6cb5] focus:ring-[#2d6cb5]/40"
              />
              <span>
                <span className="block text-sm text-[#e7ecf1]">Show model thinking</span>
                <span className="mt-0.5 block text-xs text-[#6b7a8c]">
                  Keep reasoning traces in the chat (for models that emit thinking).
                  Off by default so you only see replies and tool calls.
                </span>
              </span>
            </label>
          </section>
        </div>
      </div>
    </div>
  )
}
