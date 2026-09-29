import { useEffect, useRef, useState } from 'react'
import type {
  AzureOpenaiStatus,
  AvailableImageModel,
  ImageBackendSelection,
  LlmProvider,
  OpenAiStatus,
  TelegramStatus
} from '../../../shared/types'

interface SettingsProps {
  llmProvider: LlmProvider
  openaiEnabled: boolean
  openaiApiKeyDraft: string
  openaiStatus: OpenAiStatus
  azureOpenaiEnabled: boolean
  azureOpenaiApiKeyDraft: string
  azureOpenaiEndpoint: string
  azureOpenaiApiVersion: string
  azureOpenaiStatus: AzureOpenaiStatus
  ollamaOk: boolean
  ollamaError?: string
  baseUrl: string
  showThinking: boolean
  maxToolIterations: number
  imageBackend: ImageBackendSelection | null
  availableImageModels: AvailableImageModel[]
  telegramEnabled: boolean
  telegramAllowedUserIds: number[]
  telegramStatus: TelegramStatus
  telegramTokenDraft: string
  onSetTelegramToken: (token: string | null) => void
  onSetTelegramEnabled: (enabled: boolean) => void
  onSetTelegramAllowedUserIds: (ids: number[]) => void
  onRefreshOllama: () => void
  onSetBaseUrl: (url: string) => void
  onSetShowThinking: (enabled: boolean) => void
  onSetMaxToolIterations: (value: number) => void
  onSetLlmProvider: (provider: LlmProvider) => void
  onSetOpenaiEnabled: (enabled: boolean) => void
  onSetOpenaiApiKey: (key: string | null) => void
  onValidateOpenai: () => void
  onSetAzureEnabled: (enabled: boolean) => Promise<void>
  onSetAzureApiKey: (key: string | null) => Promise<void>
  onSetAzureEndpoint: (endpoint: string | null) => Promise<void>
  onSetAzureApiVersion: (version: string) => Promise<void>
  onValidateAzure: () => Promise<void>
  onOpenModelsPage: () => void
  onSetImageBackend: (selection: ImageBackendSelection | null) => void
}

export function Settings({
  llmProvider,
  openaiEnabled,
  openaiApiKeyDraft,
  openaiStatus,
  azureOpenaiEnabled,
  azureOpenaiApiKeyDraft,
  azureOpenaiEndpoint,
  azureOpenaiApiVersion,
  azureOpenaiStatus,
  ollamaOk,
  ollamaError,
  baseUrl,
  showThinking,
  maxToolIterations,
  imageBackend,
  availableImageModels,
  telegramEnabled,
  telegramAllowedUserIds,
  telegramStatus,
  telegramTokenDraft,
  onSetTelegramToken,
  onSetTelegramEnabled,
  onSetTelegramAllowedUserIds,
  onRefreshOllama,
  onSetBaseUrl,
  onSetShowThinking,
  onSetMaxToolIterations,
  onSetLlmProvider,
  onSetOpenaiEnabled,
  onSetOpenaiApiKey,
  onValidateOpenai,
  onSetAzureEnabled,
  onSetAzureApiKey,
  onSetAzureEndpoint,
  onSetAzureApiVersion,
  onValidateAzure,
  onOpenModelsPage,
  onSetImageBackend
}: SettingsProps): React.JSX.Element {
  const [urlDraft, setUrlDraft] = useState(baseUrl)
  const [showToken, setShowToken] = useState(false)
  const [showOpenAiKey, setShowOpenAiKey] = useState(false)
  const [tokenDraft, setTokenDraft] = useState(telegramTokenDraft)
  const [openaiKeyDraft, setOpenaiKeyDraft] = useState(openaiApiKeyDraft)
  const [azureKeyDraft, setAzureKeyDraft] = useState(azureOpenaiApiKeyDraft)
  const [azureEndpointDraft, setAzureEndpointDraft] = useState(azureOpenaiEndpoint)
  const [azureVersionDraft, setAzureVersionDraft] = useState(azureOpenaiApiVersion)
  const azureSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [allowedIdsDraft, setAllowedIdsDraft] = useState(
    telegramAllowedUserIds.join(', ')
  )

  useEffect(() => {
    setUrlDraft(baseUrl)
  }, [baseUrl])

  useEffect(() => {
    setTokenDraft(telegramTokenDraft)
  }, [telegramTokenDraft])

  useEffect(() => {
    setAllowedIdsDraft(telegramAllowedUserIds.join(', '))
  }, [telegramAllowedUserIds])

  useEffect(() => {
    setOpenaiKeyDraft(openaiApiKeyDraft)
  }, [openaiApiKeyDraft])

  useEffect(() => {
    setAzureKeyDraft(azureOpenaiApiKeyDraft)
    setAzureEndpointDraft(azureOpenaiEndpoint)
    setAzureVersionDraft(azureOpenaiApiVersion)
  }, [azureOpenaiApiKeyDraft, azureOpenaiEndpoint, azureOpenaiApiVersion])

  const persistAzureDrafts = (): Promise<void> => {
    const save = async (): Promise<void> => {
    const key = azureKeyDraft.trim()
    const endpoint = azureEndpointDraft.trim() || null
    const apiVersion = azureVersionDraft.trim() || '2024-10-21'

    // The stored key is intentionally never returned to the renderer. Only
    // persist a non-empty draft, preserving an existing masked key otherwise.
    if (key) await onSetAzureApiKey(key)
    if (endpoint !== (azureOpenaiEndpoint.trim() || null)) {
      await onSetAzureEndpoint(endpoint)
    }
    if (apiVersion !== (azureOpenaiApiVersion.trim() || '2024-10-21')) {
      await onSetAzureApiVersion(apiVersion)
    }
    }
    const queued = azureSaveQueueRef.current.then(save, save)
    azureSaveQueueRef.current = queued.catch(() => {})
    return queued
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#0f1419]">
      <header className="titlebar-drag titlebar-overlay-pad border-b border-[#243041] px-6 py-4">
        <h1 className="text-lg font-semibold text-[#f0f4f8]">Settings</h1>
        <p className="mt-1 text-sm text-[#8b9aab]">
          LLM provider, Ollama connection, OpenAI, Telegram, and chat preferences.
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-xl">
          <section className="mb-8">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#8b9aab]">
              LLM provider
            </h2>
            <label className="mb-1 block text-xs text-[#8b9aab]">Active provider</label>
            <select
              value={llmProvider}
              onChange={(e) => onSetLlmProvider(e.target.value as LlmProvider)}
              className="w-full rounded border border-[#2a3a4d] bg-[#121820] px-2 py-1.5 text-sm text-[#e7ecf1] outline-none focus:border-[#4a7ab0]"
            >
              <option value="ollama">Ollama (local)</option>
              <option value="openai">OpenAI (cloud)</option>
              <option value="azure-openai">Azure OpenAI</option>
            </select>
            <p className="mt-2 text-xs text-[#6b7a8c]">
              Chat uses the selected provider. If OpenAI is unavailable, the app falls back to
              Ollama with a warning.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#8b9aab]">
              Azure OpenAI
            </h2>
            <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-lg border border-[#2a3a4d] bg-[#121820] px-3 py-2.5">
              <input
                type="checkbox"
                checked={azureOpenaiEnabled}
                onChange={(e) => onSetAzureEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#2a3a4d] bg-[#161d27] text-[#2d6cb5] focus:ring-[#2d6cb5]/40"
              />
              <span>
                <span className="block text-sm text-[#e7ecf1]">Enable Azure OpenAI</span>
                <span className="mt-0.5 block text-xs text-[#6b7a8c]">
                  Configure an Azure resource and manage deployment names on the Models page.
                </span>
              </span>
            </label>
            <div className="mb-3 flex items-center gap-2 text-sm">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  azureOpenaiStatus.validationOk ? 'bg-emerald-400' : 'bg-rose-400'
                }`}
              />
              <span className="text-[#c5d0dc]">
                {azureOpenaiStatus.validationOk
                  ? `Validated · ${azureOpenaiStatus.enabledDeploymentCount} deployment${azureOpenaiStatus.enabledDeploymentCount === 1 ? '' : 's'} enabled`
                  : azureOpenaiStatus.validationError ?? 'Not validated'}
              </span>
            </div>
            <label className="mb-1 block text-xs text-[#8b9aab]">API key</label>
            <input
              type="password"
              value={azureKeyDraft}
              disabled={!azureOpenaiEnabled}
              onChange={(e) => setAzureKeyDraft(e.target.value)}
              onBlur={() => void persistAzureDrafts()}
              placeholder="Configured key is hidden"
              className="mb-2 w-full rounded border border-[#2a3a4d] bg-[#121820] px-2 py-1.5 text-sm text-[#e7ecf1] outline-none focus:border-[#4a7ab0] disabled:opacity-50"
            />
            <label className="mb-1 block text-xs text-[#8b9aab]">Endpoint</label>
            <input
              value={azureEndpointDraft}
              disabled={!azureOpenaiEnabled}
              onChange={(e) => setAzureEndpointDraft(e.target.value)}
              onBlur={() => void persistAzureDrafts()}
              placeholder="https://resource.openai.azure.com"
              className="mb-2 w-full rounded border border-[#2a3a4d] bg-[#121820] px-2 py-1.5 text-sm text-[#e7ecf1] outline-none focus:border-[#4a7ab0] disabled:opacity-50"
            />
            <label className="mb-1 block text-xs text-[#8b9aab]">API version</label>
            <input
              value={azureVersionDraft}
              disabled={!azureOpenaiEnabled}
              onChange={(e) => setAzureVersionDraft(e.target.value)}
              onBlur={() => void persistAzureDrafts()}
              className="mb-3 w-full rounded border border-[#2a3a4d] bg-[#121820] px-2 py-1.5 text-sm text-[#e7ecf1] outline-none focus:border-[#4a7ab0] disabled:opacity-50"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!azureOpenaiEnabled}
                onClick={() => {
                  void (async () => {
                    await persistAzureDrafts()
                    await onValidateAzure()
                  })()
                }}
                className="rounded border border-[#2a3a4d] px-3 py-1.5 text-sm text-[#c5d0dc] hover:bg-[#1a2430] disabled:opacity-50"
              >
                Validate settings
              </button>
              <button
                type="button"
                disabled={!azureOpenaiEnabled}
                onClick={onOpenModelsPage}
                className="text-sm text-[#6eb5ff] hover:underline disabled:opacity-50"
              >
                Manage deployments on Models page
              </button>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#8b9aab]">
              OpenAI
            </h2>
            <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-lg border border-[#2a3a4d] bg-[#121820] px-3 py-2.5">
              <input
                type="checkbox"
                checked={openaiEnabled}
                onChange={(e) => onSetOpenaiEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#2a3a4d] bg-[#161d27] text-[#2d6cb5] focus:ring-[#2d6cb5]/40"
              />
              <span>
                <span className="block text-sm text-[#e7ecf1]">Enable OpenAI</span>
                <span className="mt-0.5 block text-xs text-[#6b7a8c]">
                  Unlock API key validation and model management on the Models page.
                </span>
              </span>
            </label>
            <div className="mb-2 flex items-center gap-2 text-sm">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  openaiStatus.validationOk ? 'bg-emerald-400' : 'bg-rose-400'
                }`}
              />
              <span className="text-[#c5d0dc]">
                {openaiStatus.validationOk
                  ? `Validated · ${openaiStatus.enabledCount} model${openaiStatus.enabledCount === 1 ? '' : 's'} enabled for chat`
                  : openaiStatus.validationError ?? 'Not validated'}
              </span>
            </div>
            <label className="mb-1 block text-xs text-[#8b9aab]">API key</label>
            <div className="mb-2 flex gap-1">
              <input
                type={showOpenAiKey ? 'text' : 'password'}
                value={openaiKeyDraft}
                disabled={!openaiEnabled}
                onChange={(e) => setOpenaiKeyDraft(e.target.value)}
                onBlur={() => {
                  if (openaiKeyDraft !== openaiApiKeyDraft) {
                    onSetOpenaiApiKey(openaiKeyDraft.trim() || null)
                  }
                }}
                placeholder="sk-…"
                className="min-w-0 flex-1 rounded border border-[#2a3a4d] bg-[#121820] px-2 py-1.5 text-sm text-[#e7ecf1] outline-none focus:border-[#4a7ab0] disabled:opacity-50"
              />
              <button
                type="button"
                disabled={!openaiEnabled}
                onClick={() => setShowOpenAiKey((v) => !v)}
                className="rounded border border-[#2a3a4d] px-3 text-sm text-[#c5d0dc] hover:bg-[#1a2430] disabled:opacity-50"
              >
                {showOpenAiKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!openaiEnabled}
                onClick={() => {
                  onSetOpenaiApiKey(openaiKeyDraft.trim() || null)
                  onValidateOpenai()
                }}
                className="rounded border border-[#2a3a4d] px-3 py-1.5 text-sm text-[#c5d0dc] hover:bg-[#1a2430] disabled:opacity-50"
              >
                Validate &amp; fetch models
              </button>
              <button
                type="button"
                disabled={!openaiEnabled}
                onClick={onOpenModelsPage}
                className="text-sm text-[#6eb5ff] hover:underline disabled:opacity-50"
              >
                Manage models on Models page
              </button>
            </div>
          </section>

          <section className="mb-8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#8b9aab]">
                Ollama
              </h2>
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
                className="min-w-0 flex-1 rounded border border-[#2a3a4d] bg-[#121820] px-2 py-1.5 text-sm text-[#e7ecf1] outline-none focus:border-[#4a7ab0]"
              />
              <button
                type="button"
                onClick={() => onSetBaseUrl(urlDraft)}
                className="rounded border border-[#2a3a4d] px-3 text-sm text-[#c5d0dc] hover:bg-[#1a2430]"
              >
                Save
              </button>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#8b9aab]">
              Telegram
            </h2>
            <p className="mb-3 text-sm text-[#6b7a8c]">
              Create a bot via @BotFather, paste the token here, then send /start from Telegram.
            </p>
            <label className="mb-1 block text-xs text-[#8b9aab]">Bot token</label>
            <div className="mb-3 flex gap-1">
              <input
                type={showToken ? 'text' : 'password'}
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                onBlur={() => {
                  if (tokenDraft !== telegramTokenDraft) {
                    onSetTelegramToken(tokenDraft.trim() || null)
                  }
                }}
                placeholder="123456:ABC-DEF…"
                className="min-w-0 flex-1 rounded border border-[#2a3a4d] bg-[#121820] px-2 py-1.5 text-sm text-[#e7ecf1] outline-none focus:border-[#4a7ab0]"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="rounded border border-[#2a3a4d] px-3 text-sm text-[#c5d0dc] hover:bg-[#1a2430]"
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
            </div>
            <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-lg border border-[#2a3a4d] bg-[#121820] px-3 py-2.5">
              <input
                type="checkbox"
                checked={telegramEnabled}
                onChange={(e) => onSetTelegramEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#2a3a4d] bg-[#161d27] text-[#2d6cb5] focus:ring-[#2d6cb5]/40"
              />
              <span>
                <span className="block text-sm text-[#e7ecf1]">Enable Telegram bot</span>
                <span className="mt-0.5 block text-xs text-[#6b7a8c]">
                  Mirror chat activity to Telegram when a valid token is saved.
                </span>
              </span>
            </label>
            <div className="mb-3 flex items-center gap-2 text-sm">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  telegramStatus.running && !telegramStatus.error
                    ? 'bg-emerald-400'
                    : 'bg-rose-400'
                }`}
              />
              <span className="text-[#c5d0dc]">
                {telegramStatus.error
                  ? telegramStatus.error
                  : telegramStatus.running && telegramStatus.botUsername
                    ? `Running as @${telegramStatus.botUsername}`
                    : 'Stopped'}
              </span>
            </div>
            <p className="mb-3 text-xs text-[#6b7a8c]">
              While the model works, Telegram shows a live status line (thinking, tool calls,
              writing), then the final reply.
            </p>
            <label className="mb-1 block text-xs text-[#8b9aab]">Allowed user IDs</label>
            <div className="flex gap-1">
              <input
                value={allowedIdsDraft}
                onChange={(e) => setAllowedIdsDraft(e.target.value)}
                placeholder="123456789, 987654321"
                className="min-w-0 flex-1 rounded border border-[#2a3a4d] bg-[#121820] px-2 py-1.5 text-sm text-[#e7ecf1] outline-none focus:border-[#4a7ab0]"
              />
              <button
                type="button"
                onClick={() => {
                  const ids = allowedIdsDraft
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((s) => Number(s))
                    .filter((n) => Number.isFinite(n))
                  onSetTelegramAllowedUserIds(ids)
                }}
                className="rounded border border-[#2a3a4d] px-3 text-sm text-[#c5d0dc] hover:bg-[#1a2430]"
              >
                Save
              </button>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#8b9aab]">
              Chat
            </h2>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#2a3a4d] bg-[#121820] px-3 py-2.5">
              <input
                type="checkbox"
                checked={Boolean(showThinking)}
                onChange={(e) => onSetShowThinking(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#2a3a4d] bg-[#161d27] text-[#2d6cb5] focus:ring-[#2d6cb5]/40"
              />
              <span>
                <span className="block text-sm text-[#e7ecf1]">Show model thinking</span>
                <span className="mt-0.5 block text-xs text-[#6b7a8c]">
                  Keep reasoning traces in the chat (for models that emit thinking). Off by
                  default so you only see replies and tool calls.
                </span>
              </span>
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-sm text-[#e7ecf1]">Max tool iterations</span>
              <span className="mb-2 block text-xs text-[#6b7a8c]">
                How many tool-call rounds the agent can run per message. A final summary is
                added if the limit is reached.
              </span>
              <input
                type="number"
                min={8}
                max={100}
                value={maxToolIterations}
                onChange={(e) => {
                  const parsed = Number(e.target.value)
                  if (Number.isFinite(parsed)) onSetMaxToolIterations(parsed)
                }}
                className="w-24 rounded border border-[#2a3a4d] bg-[#121820] px-2 py-1.5 text-sm text-[#e7ecf1] outline-none focus:border-[#4a7ab0]"
              />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-sm text-[#e7ecf1]">Image backend</span>
              <span className="mb-2 block text-xs text-[#6b7a8c]">
                Used when a chat model calls generate_image. Image editing requires OpenAI.
              </span>
              <select
                  value={
                    imageBackend
                      ? `${imageBackend.provider}:${imageBackend.model}`
                      : ''
                  }
                  onChange={(e) =>
                    onSetImageBackend(
                      e.target.value === ''
                        ? null
                        : (() => {
                            const separator = e.target.value.indexOf(':')
                            return {
                              provider: e.target.value.slice(0, separator) as ImageBackendSelection['provider'],
                              model: e.target.value.slice(separator + 1)
                            }
                          })()
                    )
                  }
                  className="w-full rounded border border-[#2a3a4d] bg-[#121820] px-2 py-1.5 text-sm text-[#e7ecf1] outline-none focus:border-[#4a7ab0]"
                >
                  <option value="">Auto / None</option>
                  {(['ollama', 'openai'] as const).map((provider) => {
                    const entries = availableImageModels.filter(
                      (entry) => entry.provider === provider
                    )
                    if (entries.length === 0) return null
                    return (
                      <optgroup
                        key={provider}
                        label={provider === 'openai' ? 'OpenAI' : 'Ollama'}
                      >
                        {entries.map((entry) => (
                          <option
                            key={`${entry.provider}:${entry.model}`}
                            value={`${entry.provider}:${entry.model}`}
                          >
                            {provider === 'openai' ? 'OpenAI' : 'Ollama'} · {entry.model}
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
              {availableImageModels.length === 0 && (
                <p className="mt-2 text-xs text-[#6b7a8c]">
                  No image models available — image generation is disabled until one is available.
                </p>
              )}
            </label>
          </section>
        </div>
      </div>
    </main>
  )
}
