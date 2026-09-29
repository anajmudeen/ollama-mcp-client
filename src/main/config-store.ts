import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import Store from 'electron-store'
import {
  normalizeImageGallery,
  sortImageGalleryItems
} from '../shared/image-gallery'
import { isOpenAiImageGenModel } from '../shared/openai-models'
import type {
  AppConfig,
  AvailableImageModel,
  ChatMessage,
  ChatSession,
  ImageBackendSelection,
  ImageGalleryItem,
  LlmProvider,
  McpServerConfig,
  AzureOpenaiDeploymentEntry,
  AzureOpenaiModelEntry,
  OpenAiModelEntry,
  SelectedModelByProvider,
  SessionOrigin,
  SessionsListState,
  SessionsState,
  TelegramMirrorMode,
  TelegramSchedule,
  UiMessage
} from '../shared/types'
import {
  toSessionSummary,
  toSessionsListState
} from '../shared/session-summary'
import {
  deleteSessionImages,
  externalizeUiMessageImages,
  uiMessagesHaveInlineImages
} from './session-images'

export { toSessionSummary }

const DEFAULT_SELECTED_BY_PROVIDER: SelectedModelByProvider = {
  ollama: null,
  openai: null,
  'azure-openai': null
}

const DEFAULT_CONFIG: AppConfig = {
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  selectedModel: null,
  llmProvider: 'ollama',
  openaiEnabled: false,
  openaiApiKey: null,
  openaiValidationOk: false,
  openaiValidationError: null,
  openaiModelsCatalog: [],
  openaiModelEnabled: {},
  azureOpenaiEnabled: false,
  azureOpenaiApiKey: null,
  azureOpenaiEndpoint: null,
  azureOpenaiApiVersion: '2024-10-21',
  azureOpenaiValidationOk: false,
  azureOpenaiValidationError: null,
  azureOpenaiModelsCatalog: [],
  azureOpenaiDeployments: [],
  selectedModelByProvider: { ...DEFAULT_SELECTED_BY_PROVIDER },
  servers: [],
  showThinking: false,
  maxToolIterations: 30,
  telegramBotToken: null,
  telegramEnabled: false,
  telegramAllowedUserIds: [],
  telegramMirrorMode: 'full',
  imageBackend: null,
  defaultImageModel: null
}

interface StoreSchema extends AppConfig, SessionsState {
  skillEnabled: Record<string, boolean>
  schedules: TelegramSchedule[]
  imageGallery: ImageGalleryItem[]
}

function sessionOrigin(session: ChatSession): SessionOrigin {
  return session.origin ?? 'desktop'
}

function normalizeSession(session: ChatSession): ChatSession {
  const origin = sessionOrigin(session)
  return session.origin === origin ? session : { ...session, origin }
}

function isDesktopSession(session: ChatSession): boolean {
  return sessionOrigin(session) === 'desktop'
}

function isTelegramSession(session: ChatSession): boolean {
  return sessionOrigin(session) === 'telegram'
}

const store = new Store<StoreSchema>({
  name: 'config',
  defaults: {
    ...DEFAULT_CONFIG,
    sessions: [],
    activeSessionId: null,
    telegramActiveSessionId: null,
    skillEnabled: {},
    schedules: [],
    imageGallery: []
  }
})

let sessionsCache: ChatSession[] | null = null
let activeSessionIdCache: string | null | undefined
let telegramActiveSessionIdCache: string | null | undefined
let sessionPersistTimer: ReturnType<typeof setTimeout> | null = null

function cachedSessions(): ChatSession[] {
  if (!sessionsCache) {
    sessionsCache = store
      .get('sessions', [])
      .map(normalizeSession)
      .map(withActivityTimestamp)
  }
  return sessionsCache
}

function scheduleSessionsPersist(): void {
  if (sessionPersistTimer !== null) return
  sessionPersistTimer = setTimeout(() => {
    sessionPersistTimer = null
    store.store = {
      ...store.store,
      sessions: sessionsCache ?? [],
      activeSessionId: activeSessionIdCache ?? null,
      telegramActiveSessionId: telegramActiveSessionIdCache ?? null
    }
  }, 100)
}

function hasPersistedSelectedModelByProvider(): boolean {
  try {
    const persisted = JSON.parse(readFileSync(store.path, 'utf8')) as unknown
    return Boolean(
      persisted &&
        typeof persisted === 'object' &&
        Object.prototype.hasOwnProperty.call(persisted, 'selectedModelByProvider')
    )
  } catch {
    return false
  }
}

export function migrateSelectedModelByProvider(
  persisted: boolean,
  stored: Partial<SelectedModelByProvider> | undefined,
  legacy: string | null
): SelectedModelByProvider {
  if (!persisted) {
    return {
      ollama: legacy,
      openai: null,
      'azure-openai': null
    }
  }
  return {
    ollama: stored?.ollama ?? null,
    openai: stored?.openai ?? null,
    'azure-openai': stored?.['azure-openai'] ?? null
  }
}

function readSelectedModelByProvider(): SelectedModelByProvider {
  if (!hasPersistedSelectedModelByProvider()) {
    const legacy = store.get('selectedModel', DEFAULT_CONFIG.selectedModel)
    const migrated = migrateSelectedModelByProvider(false, undefined, legacy)
    store.set('selectedModelByProvider', migrated)
    return migrated
  }

  const stored = store.get('selectedModelByProvider') as SelectedModelByProvider | undefined
  if (stored && typeof stored === 'object') {
    const migrated = migrateSelectedModelByProvider(true, stored, null)
    if (!('azure-openai' in stored)) store.set('selectedModelByProvider', migrated)
    return migrated
  }
  return { ...DEFAULT_SELECTED_BY_PROVIDER }
}

export function getConfig(): AppConfig {
  const llmProvider = getLlmProvider()
  const selectedModelByProvider = getSelectedModelByProvider()
  const selectedModel =
    selectedModelByProvider[llmProvider] ??
    store.get('selectedModel', DEFAULT_CONFIG.selectedModel)

  return {
    ollamaBaseUrl: store.get('ollamaBaseUrl', DEFAULT_CONFIG.ollamaBaseUrl),
    selectedModel,
    llmProvider,
    openaiEnabled: store.get('openaiEnabled', DEFAULT_CONFIG.openaiEnabled),
    openaiApiKey: null,
    openaiValidationOk: store.get(
      'openaiValidationOk',
      DEFAULT_CONFIG.openaiValidationOk
    ),
    openaiValidationError: store.get(
      'openaiValidationError',
      DEFAULT_CONFIG.openaiValidationError
    ),
    openaiModelsCatalog: getOpenaiModelsCatalog(),
    openaiModelEnabled: getOpenaiModelEnabledMap(),
    azureOpenaiEnabled: getAzureOpenaiEnabled(),
    azureOpenaiApiKey: null,
    azureOpenaiEndpoint: getAzureOpenaiEndpoint(),
    azureOpenaiApiVersion: getAzureOpenaiApiVersion(),
    azureOpenaiValidationOk: getAzureOpenaiValidationState().ok,
    azureOpenaiValidationError: getAzureOpenaiValidationState().error,
    azureOpenaiModelsCatalog: getAzureOpenaiModelsCatalog(),
    azureOpenaiDeployments: getAzureOpenaiDeployments(),
    selectedModelByProvider,
    servers: store.get('servers', DEFAULT_CONFIG.servers),
    showThinking: store.get('showThinking', DEFAULT_CONFIG.showThinking),
    maxToolIterations: clampMaxToolIterations(
      store.get('maxToolIterations', DEFAULT_CONFIG.maxToolIterations)
    ),
    telegramBotToken: store.get('telegramBotToken', DEFAULT_CONFIG.telegramBotToken),
    telegramEnabled: store.get('telegramEnabled', DEFAULT_CONFIG.telegramEnabled),
    telegramAllowedUserIds: store.get(
      'telegramAllowedUserIds',
      DEFAULT_CONFIG.telegramAllowedUserIds
    ),
    telegramMirrorMode: store.get(
      'telegramMirrorMode',
      DEFAULT_CONFIG.telegramMirrorMode
    ),
    imageBackend: getImageBackend(),
    defaultImageModel: store.get('defaultImageModel', DEFAULT_CONFIG.defaultImageModel)
  }
}

export function getOllamaBaseUrl(): string {
  return store.get('ollamaBaseUrl', DEFAULT_CONFIG.ollamaBaseUrl)
}

export function setOllamaBaseUrl(url: string): string {
  const trimmed = url.replace(/\/$/, '')
  store.set('ollamaBaseUrl', trimmed)
  return trimmed
}

export function getLlmProvider(): LlmProvider {
  const v = store.get('llmProvider', DEFAULT_CONFIG.llmProvider)
  if (v === 'openai' || v === 'azure-openai') return v
  return 'ollama'
}

export function setLlmProvider(provider: LlmProvider): LlmProvider {
  const next: LlmProvider =
    provider === 'openai' || provider === 'azure-openai' ? provider : 'ollama'
  store.set('llmProvider', next)
  return next
}

export function getOpenaiEnabled(): boolean {
  return store.get('openaiEnabled', DEFAULT_CONFIG.openaiEnabled)
}

export function setOpenaiEnabled(enabled: boolean): boolean {
  store.set('openaiEnabled', enabled)
  return enabled
}

export function getOpenaiApiKey(): string | null {
  return store.get('openaiApiKey', DEFAULT_CONFIG.openaiApiKey)
}

export function setOpenaiApiKey(key: string | null): string | null {
  const trimmed = key?.trim() || null
  store.set('openaiApiKey', trimmed)
  if (!trimmed) {
    setOpenaiValidationOk(false, 'API key not configured')
  }
  return trimmed
}

export function getOpenaiValidationState(): {
  ok: boolean
  error: string | null
} {
  return {
    ok: store.get('openaiValidationOk', DEFAULT_CONFIG.openaiValidationOk),
    error: store.get('openaiValidationError', DEFAULT_CONFIG.openaiValidationError)
  }
}

export function setOpenaiValidationOk(ok: boolean, error?: string | null): void {
  store.set('openaiValidationOk', ok)
  store.set('openaiValidationError', ok ? null : (error ?? 'Validation failed'))
}

export function getOpenaiModelsCatalog(): OpenAiModelEntry[] {
  return [...store.get('openaiModelsCatalog', DEFAULT_CONFIG.openaiModelsCatalog)]
}

export function setOpenaiModelsCatalog(entries: OpenAiModelEntry[]): OpenAiModelEntry[] {
  store.set('openaiModelsCatalog', entries)
  return entries
}

export function getOpenaiModelEnabledMap(): Record<string, boolean> {
  return { ...store.get('openaiModelEnabled', DEFAULT_CONFIG.openaiModelEnabled) }
}

export function setOpenaiModelEnabled(id: string, enabled: boolean): Record<string, boolean> {
  const map = getOpenaiModelEnabledMap()
  map[id] = enabled
  store.set('openaiModelEnabled', map)
  return map
}

export function mergeOpenaiCatalog(entries: OpenAiModelEntry[]): OpenAiModelEntry[] {
  const ids = new Set(entries.map((e) => e.id))
  const enabled = getOpenaiModelEnabledMap()
  const nextEnabled: Record<string, boolean> = {}
  for (const id of Object.keys(enabled)) {
    if (ids.has(id) && enabled[id]) {
      nextEnabled[id] = true
    }
  }
  for (const entry of entries) {
    if (!(entry.id in nextEnabled)) {
      nextEnabled[entry.id] = false
    }
  }
  store.set('openaiModelEnabled', nextEnabled)
  setOpenaiModelsCatalog(entries)

  const byProvider = getSelectedModelByProvider()
  if (byProvider.openai && !ids.has(byProvider.openai)) {
    setSelectedModelForProvider('openai', null)
  }
  return entries
}

export function getAzureOpenaiEnabled(): boolean {
  return store.get('azureOpenaiEnabled', DEFAULT_CONFIG.azureOpenaiEnabled)
}

export function setAzureOpenaiEnabled(enabled: boolean): boolean {
  store.set('azureOpenaiEnabled', enabled)
  return enabled
}

export function getAzureOpenaiApiKey(): string | null {
  return store.get('azureOpenaiApiKey', DEFAULT_CONFIG.azureOpenaiApiKey)
}

export function setAzureOpenaiApiKey(key: string | null): string | null {
  const trimmed = key?.trim() || null
  store.set('azureOpenaiApiKey', trimmed)
  if (!trimmed) setAzureOpenaiValidationOk(false, 'API key not configured')
  return trimmed
}

export function getAzureOpenaiEndpoint(): string | null {
  return store.get('azureOpenaiEndpoint', DEFAULT_CONFIG.azureOpenaiEndpoint)
}

export function setAzureOpenaiEndpoint(endpoint: string | null): string | null {
  const normalized = endpoint?.trim().replace(/\/+$/, '') || null
  store.set('azureOpenaiEndpoint', normalized)
  return normalized
}

export function getAzureOpenaiApiVersion(): string {
  return store.get('azureOpenaiApiVersion', DEFAULT_CONFIG.azureOpenaiApiVersion)
}

export function setAzureOpenaiApiVersion(version: string): string {
  const normalized = version.trim() || DEFAULT_CONFIG.azureOpenaiApiVersion
  store.set('azureOpenaiApiVersion', normalized)
  return normalized
}

export function getAzureOpenaiValidationState(): {
  ok: boolean
  error: string | null
} {
  return {
    ok: store.get('azureOpenaiValidationOk', DEFAULT_CONFIG.azureOpenaiValidationOk),
    error: store.get(
      'azureOpenaiValidationError',
      DEFAULT_CONFIG.azureOpenaiValidationError
    )
  }
}

export function setAzureOpenaiValidationOk(ok: boolean, error?: string | null): void {
  store.set('azureOpenaiValidationOk', ok)
  store.set('azureOpenaiValidationError', ok ? null : (error ?? 'Validation failed'))
}

export function getAzureOpenaiModelsCatalog(): AzureOpenaiModelEntry[] {
  const stored = store.get('azureOpenaiModelsCatalog', DEFAULT_CONFIG.azureOpenaiModelsCatalog)
  if (Array.isArray(stored) && stored.length > 0) {
    store.set('azureOpenaiModelsCatalog', [])
  }
  return []
}

export function setAzureOpenaiModelsCatalog(
  _entries: AzureOpenaiModelEntry[]
): AzureOpenaiModelEntry[] {
  store.set('azureOpenaiModelsCatalog', [])
  return []
}

export function getAzureOpenaiDeployments(): AzureOpenaiDeploymentEntry[] {
  const raw = store.get('azureOpenaiDeployments', DEFAULT_CONFIG.azureOpenaiDeployments)
  const normalized = raw.map(normalizeAzureDeployment)
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
    store.set('azureOpenaiDeployments', normalized)
  }
  return [...normalized]
}

function normalizeAzureDeployment(
  deployment: AzureOpenaiDeploymentEntry
): AzureOpenaiDeploymentEntry {
  return {
    name: deployment.name.trim(),
    enabled: Boolean(deployment.enabled)
  }
}

export function addAzureOpenaiDeployment(
  deployment: AzureOpenaiDeploymentEntry | string
): AzureOpenaiDeploymentEntry[] {
  const next = normalizeAzureDeployment(
    typeof deployment === 'string'
      ? { name: deployment, enabled: false }
      : deployment
  )
  if (!next.name) throw new Error('Deployment name is required')
  const deployments = getAzureOpenaiDeployments()
  const index = deployments.findIndex((entry) => entry.name === next.name)
  if (index >= 0) {
    // Adding by name is idempotent; it must not reset an existing explicit toggle.
    if (typeof deployment !== 'string') {
      deployments[index] = { ...deployments[index], ...next }
    }
  }
  else deployments.push(next)
  store.set('azureOpenaiDeployments', deployments)
  return deployments
}

export function updateAzureOpenaiDeployment(
  name: string,
  patch: Partial<Omit<AzureOpenaiDeploymentEntry, 'name'>>
): AzureOpenaiDeploymentEntry[] {
  const current = getAzureOpenaiDeployments()
  const index = current.findIndex((entry) => entry.name === name.trim())
  if (index < 0) return current
  current[index] = normalizeAzureDeployment({ ...current[index], ...patch })
  store.set('azureOpenaiDeployments', current)
  return current
}

export function removeAzureOpenaiDeployment(name: string): AzureOpenaiDeploymentEntry[] {
  const deployments = getAzureOpenaiDeployments().filter(
    (entry) => entry.name !== name.trim()
  )
  store.set('azureOpenaiDeployments', deployments)
  return deployments
}

export function setAzureOpenaiDeploymentEnabled(
  name: string,
  enabled: boolean
): AzureOpenaiDeploymentEntry[] {
  const deployments = updateAzureOpenaiDeployment(name, { enabled })
  if (!enabled && getSelectedModelForProvider('azure-openai') === name.trim()) {
    setSelectedModelForProvider('azure-openai', null)
  }
  return deployments
}

/** @deprecated Task 2 removes IPC usage; clears catalog and strips deployment metadata. */
export function mergeAzureOpenaiCatalog(
  _entries: AzureOpenaiModelEntry[]
): AzureOpenaiModelEntry[] {
  store.set('azureOpenaiModelsCatalog', [])
  store.set(
    'azureOpenaiDeployments',
    getAzureOpenaiDeployments().map(normalizeAzureDeployment)
  )
  return []
}

export function getSelectedModelByProvider(): SelectedModelByProvider {
  return readSelectedModelByProvider()
}

export function getSelectedModelForProvider(provider: LlmProvider): string | null {
  return getSelectedModelByProvider()[provider]
}

export function setSelectedModelForProvider(
  provider: LlmProvider,
  model: string | null
): SelectedModelByProvider {
  const current = readSelectedModelByProvider()
  const next = { ...current, [provider]: model }
  store.set('selectedModelByProvider', next)
  if (provider === getLlmProvider()) {
    store.set('selectedModel', model)
  }
  return next
}

export function getSelectedModel(): string | null {
  const provider = getLlmProvider()
  return getSelectedModelForProvider(provider)
}

export function setSelectedModel(model: string | null): void {
  setSelectedModelForProvider(getLlmProvider(), model)
}

export function getShowThinking(): boolean {
  return store.get('showThinking', DEFAULT_CONFIG.showThinking)
}

export function setShowThinking(enabled: boolean): boolean {
  store.set('showThinking', enabled)
  return enabled
}

export const MIN_MAX_TOOL_ITERATIONS = 8
export const MAX_MAX_TOOL_ITERATIONS = 100

export function clampMaxToolIterations(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONFIG.maxToolIterations
  return Math.min(MAX_MAX_TOOL_ITERATIONS, Math.max(MIN_MAX_TOOL_ITERATIONS, Math.round(value)))
}

export function getMaxToolIterations(): number {
  return clampMaxToolIterations(
    store.get('maxToolIterations', DEFAULT_CONFIG.maxToolIterations)
  )
}

export function setMaxToolIterations(value: number): number {
  const clamped = clampMaxToolIterations(value)
  store.set('maxToolIterations', clamped)
  return clamped
}

export function getTelegramBotToken(): string | null {
  return store.get('telegramBotToken', DEFAULT_CONFIG.telegramBotToken)
}

export function setTelegramBotToken(token: string | null): string | null {
  const trimmed = token?.trim() || null
  store.set('telegramBotToken', trimmed)
  return trimmed
}

export function getTelegramEnabled(): boolean {
  return store.get('telegramEnabled', DEFAULT_CONFIG.telegramEnabled)
}

export function setTelegramEnabled(enabled: boolean): boolean {
  store.set('telegramEnabled', enabled)
  return enabled
}

export function getTelegramAllowedUserIds(): number[] {
  return [...store.get('telegramAllowedUserIds', DEFAULT_CONFIG.telegramAllowedUserIds)]
}

export function setTelegramAllowedUserIds(ids: number[]): number[] {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id)))]
  store.set('telegramAllowedUserIds', unique)
  return unique
}

export function getTelegramMirrorMode(): TelegramMirrorMode {
  return store.get('telegramMirrorMode', DEFAULT_CONFIG.telegramMirrorMode)
}

export function setTelegramMirrorMode(mode: TelegramMirrorMode): TelegramMirrorMode {
  store.set('telegramMirrorMode', mode)
  return mode
}

function normalizeImageBackend(
  selection: unknown
): ImageBackendSelection | null {
  if (!selection || typeof selection !== 'object') return null
  const candidate = selection as { provider?: unknown; model?: unknown }
  const provider = candidate.provider
  const model = typeof candidate.model === 'string' ? candidate.model.trim() : ''
  if (
    (provider !== 'openai' && provider !== 'ollama') ||
    !model
  ) {
    return null
  }
  return { provider, model }
}

/**
 * Resolve a legacy model against already-verified availability.
 *
 * OpenAI is intentionally checked first so a model name collision cannot
 * change the backend identity during migration.
 */
export function migrateImageBackend(
  legacyModel: string | null | undefined,
  persisted: unknown,
  openaiImageModels: string[],
  installedOllamaImageModels: string[]
): ImageBackendSelection | null {
  // `undefined` means the structured field is absent. A persisted null (or
  // malformed value) is an explicit structured choice and must not fall back
  // to the legacy model.
  if (persisted !== undefined) {
    return normalizeImageBackend(persisted)
  }

  const legacy = typeof legacyModel === 'string' ? legacyModel.trim() : ''
  if (!legacy) return null
  if (openaiImageModels.includes(legacy)) {
    return { provider: 'openai', model: legacy }
  }
  if (installedOllamaImageModels.includes(legacy)) {
    return { provider: 'ollama', model: legacy }
  }
  return null
}

function hasPersistedImageBackend(): boolean {
  try {
    return store.has('imageBackend')
  } catch {
    return false
  }
}

export function getImageBackend(): ImageBackendSelection | null {
  const persisted = hasPersistedImageBackend() ? store.get('imageBackend') : undefined
  const openaiImageModels = getOpenaiModelsCatalog()
    .map((entry) => entry.id)
    .filter(
      (id) =>
        getOpenaiModelEnabledMap()[id] === true &&
        isOpenAiImageGenModel(id)
    )
  const legacy = store.get('defaultImageModel', DEFAULT_CONFIG.defaultImageModel)
  const migrated = migrateImageBackend(
    legacy,
    persisted,
    openaiImageModels,
    []
  )
  if (migrated && persisted === undefined) store.set('imageBackend', migrated)
  return migrated
}

export function migrateImageBackendAfterDiscovery(
  available: AvailableImageModel[]
): ImageBackendSelection | null {
  const persisted = hasPersistedImageBackend() ? store.get('imageBackend') : undefined
  const migrated = migrateImageBackend(
    store.get('defaultImageModel', DEFAULT_CONFIG.defaultImageModel),
    persisted,
    available.filter((entry) => entry.provider === 'openai').map((entry) => entry.model),
    available.filter((entry) => entry.provider === 'ollama').map((entry) => entry.model)
  )
  if (migrated && persisted === undefined) store.set('imageBackend', migrated)
  return migrated
}

/** Test-only reset for exercising first-read migration behavior. */
export function clearImageBackendForMigrationTest(): void {
  store.delete('imageBackend')
}

export function setImageBackend(
  selection: ImageBackendSelection | null
): ImageBackendSelection | null {
  const normalized = normalizeImageBackend(selection)
  if (selection !== null && !normalized) {
    throw new Error('Image backend provider and model are required')
  }
  store.set('imageBackend', normalized)
  return normalized
}

export function getDefaultImageModel(): string | null {
  return store.get('defaultImageModel', DEFAULT_CONFIG.defaultImageModel)
}

export function setDefaultImageModel(model: string | null): string | null {
  const value = model && model.trim() ? model.trim() : null
  store.set('defaultImageModel', value)
  return value
}

export function listImageGallery(): ImageGalleryItem[] {
  const normalized = normalizeImageGallery(store.get('imageGallery', []))
  store.set('imageGallery', normalized)
  return sortImageGalleryItems(normalized)
}

export function addImageGalleryItem(
  input: Omit<ImageGalleryItem, 'id' | 'createdAt'> & {
    id?: string
    createdAt?: string
  }
): ImageGalleryItem {
  const candidate = {
    ...input,
    id: input.id ?? randomUUID(),
    createdAt: input.createdAt ?? new Date().toISOString()
  }
  const item = normalizeImageGallery([candidate])[0]
  if (!item) throw new Error('Invalid image gallery item')
  const records = normalizeImageGallery([item, ...store.get('imageGallery', [])])
  store.set('imageGallery', records)
  return item
}

export function deleteImageGalleryItem(id: string): boolean {
  const records = normalizeImageGallery(store.get('imageGallery', []))
  const next = records.filter((item) => item.id !== id)
  if (next.length === records.length) return false
  store.set('imageGallery', next)
  return true
}

export function addTelegramAllowedUserId(id: number): number[] {
  const ids = getTelegramAllowedUserIds()
  if (!ids.includes(id)) ids.push(id)
  return setTelegramAllowedUserIds(ids)
}

export function listServers(): McpServerConfig[] {
  return store.get('servers', [])
}

export function upsertServer(server: McpServerConfig): McpServerConfig[] {
  const servers = listServers()
  const idx = servers.findIndex((s) => s.id === server.id)
  if (idx >= 0) {
    servers[idx] = server
  } else {
    servers.push(server)
  }
  store.set('servers', servers)
  return servers
}

export function setServerEnabled(id: string, enabled: boolean): McpServerConfig | null {
  const servers = listServers()
  const idx = servers.findIndex((s) => s.id === id)
  if (idx < 0) return null
  servers[idx] = { ...servers[idx], enabled }
  store.set('servers', servers)
  return servers[idx]
}

export function removeServer(id: string): McpServerConfig[] {
  const servers = listServers().filter((s) => s.id !== id)
  store.set('servers', servers)
  return servers
}

function stripHeavyHistory(history: ChatMessage[]): ChatMessage[] {
  // Avoid persisting multi-MB image payloads in electron-store
  return history.map((m) => {
    if (!m.images?.length) return m
    const { images: _images, ...rest } = m
    return rest
  })
}

function lastMessageCreatedAt(uiMessages: UiMessage[]): string | null {
  for (let i = uiMessages.length - 1; i >= 0; i--) {
    const createdAt = uiMessages[i]?.createdAt
    if (createdAt) return createdAt
  }
  return null
}

/** Session recency is last message time — not last open/flush. */
function sessionActivityAt(session: ChatSession): string {
  return lastMessageCreatedAt(session.uiMessages) ?? session.createdAt
}

function withActivityTimestamp(session: ChatSession): ChatSession {
  const updatedAt = sessionActivityAt(session)
  return session.updatedAt === updatedAt ? session : { ...session, updatedAt }
}

function sortSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort(
    (a, b) =>
      new Date(sessionActivityAt(b)).getTime() -
      new Date(sessionActivityAt(a)).getTime()
  )
}

export function listSessions(): ChatSession[] {
  return sortSessions(cachedSessions())
}

export function getSession(id: string): ChatSession | null {
  return listSessions().find((s) => s.id === id) ?? null
}

function applyExternalizedMessages(
  sessionId: string,
  uiMessages: UiMessage[]
): UiMessage[] {
  const { messages, changed } = externalizeUiMessageImages(sessionId, uiMessages)
  return changed ? messages : uiMessages
}

function externalizeSessionInCache(sessionId: string): boolean {
  const sessions = [...cachedSessions()]
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx < 0) return false
  const current = sessions[idx]!
  if (!uiMessagesHaveInlineImages(current.uiMessages)) return false
  const { messages, changed } = externalizeUiMessageImages(
    sessionId,
    current.uiMessages
  )
  if (!changed) return false
  sessions[idx] = { ...current, uiMessages: messages }
  sessionsCache = sessions
  scheduleSessionsPersist()
  return true
}

/** Sync: externalize inline images for the active session before first list. */
export function migrateActiveSessionImages(): void {
  const activeId = getActiveSessionId()
  if (!activeId) return
  externalizeSessionInCache(activeId)
}

let remainingMigrateStarted = false

/** Async: externalize remaining sessions after UI is up. */
export function migrateRemainingSessionImagesInBackground(): void {
  if (remainingMigrateStarted) return
  remainingMigrateStarted = true
  setImmediate(() => {
    const sessions = [...cachedSessions()]
    const activeId = getActiveSessionId()
    let any = false
    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i]!
      if (session.id === activeId) continue
      if (!uiMessagesHaveInlineImages(session.uiMessages)) continue
      const { messages, changed } = externalizeUiMessageImages(
        session.id,
        session.uiMessages
      )
      if (!changed) continue
      sessions[i] = { ...session, uiMessages: messages }
      any = true
    }
    if (any) {
      sessionsCache = sessions
      scheduleSessionsPersist()
    }
  })
}

export function getActiveSessionId(): string | null {
  if (activeSessionIdCache === undefined) {
    activeSessionIdCache = store.get('activeSessionId', null)
  }
  return activeSessionIdCache
}

export function getTelegramActiveSessionId(): string | null {
  if (telegramActiveSessionIdCache === undefined) {
    telegramActiveSessionIdCache = store.get('telegramActiveSessionId', null)
  }
  return telegramActiveSessionIdCache
}

function ensureDesktopSessionExists(): void {
  const sessions = listSessions()
  if (sessions.some(isDesktopSession)) return

  const now = new Date().toISOString()
  const session: ChatSession = {
    id: randomUUID(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    uiMessages: [],
    history: [],
    origin: 'desktop'
  }
  sessionsCache = [session, ...sessions]
  scheduleSessionsPersist()
}

export function getSessionsState(): SessionsState {
  const sessions = listSessions()
  let activeSessionId = getActiveSessionId()
  let telegramActiveSessionId = getTelegramActiveSessionId()

  if (activeSessionId && !sessions.some((s) => s.id === activeSessionId)) {
    const desktopSessions = sessions.filter(isDesktopSession)
    activeSessionId = desktopSessions[0]?.id ?? sessions[0]?.id ?? null
    activeSessionIdCache = activeSessionId
    scheduleSessionsPersist()
  }

  const telegramSessions = sessions.filter(isTelegramSession)
  if (
    telegramActiveSessionId &&
    !telegramSessions.some((s) => s.id === telegramActiveSessionId)
  ) {
    telegramActiveSessionId = telegramSessions[0]?.id ?? null
    telegramActiveSessionIdCache = telegramActiveSessionId
    scheduleSessionsPersist()
  }

  return { sessions, activeSessionId, telegramActiveSessionId }
}

export function getSessionsListState(): SessionsListState {
  return toSessionsListState(getSessionsState())
}

export function createSession(origin: SessionOrigin = 'desktop'): ChatSession {
  const now = new Date().toISOString()
  const session: ChatSession = {
    id: randomUUID(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    uiMessages: [],
    history: [],
    origin
  }
  const sessions = [session, ...listSessions()]
  sessionsCache = sessions
  if (origin === 'telegram') {
    telegramActiveSessionIdCache = session.id
  } else {
    activeSessionIdCache = session.id
  }
  scheduleSessionsPersist()
  return session
}

export function setTelegramActiveSession(id: string): SessionsState {
  const session = listSessions().find((s) => s.id === id)
  if (!session || !isTelegramSession(session)) {
    throw new Error('Telegram session not found')
  }
  telegramActiveSessionIdCache = id
  scheduleSessionsPersist()
  return getSessionsState()
}

export function setActiveSession(id: string): SessionsState {
  const sessions = listSessions()
  if (!sessions.some((s) => s.id === id)) {
    throw new Error('Session not found')
  }
  activeSessionIdCache = id
  scheduleSessionsPersist()
  return getSessionsState()
}

export function updateSession(
  id: string,
  patch: Partial<Pick<ChatSession, 'title' | 'uiMessages' | 'history'>>
): ChatSession {
  const sessions = [...cachedSessions()]
  const idx = sessions.findIndex((s) => s.id === id)
  if (idx < 0) throw new Error('Session not found')

  const nextMessages = applyExternalizedMessages(
    id,
    patch.uiMessages ?? sessions[idx]!.uiMessages
  )
  const updated: ChatSession = {
    ...sessions[idx]!,
    ...patch,
    history: patch.history
      ? stripHeavyHistory(patch.history)
      : sessions[idx]!.history,
    uiMessages: nextMessages,
    updatedAt: lastMessageCreatedAt(nextMessages) ?? sessions[idx]!.createdAt
  }
  sessions[idx] = updated
  sessionsCache = sessions
  scheduleSessionsPersist()
  return updated
}

export function deleteSession(id: string): SessionsState {
  deleteSessionImages(id)
  let sessions = listSessions().filter((s) => s.id !== id)
  let activeSessionId = getActiveSessionId()
  let telegramActiveSessionId = getTelegramActiveSessionId()

  if (activeSessionId === id) {
    const desktopSessions = sessions.filter(isDesktopSession)
    activeSessionId = desktopSessions[0]?.id ?? null
  }

  if (telegramActiveSessionId === id) {
    const telegramSessions = sessions.filter(isTelegramSession)
    telegramActiveSessionId = telegramSessions[0]?.id ?? null
  }

  if (sessions.length === 0) {
    const now = new Date().toISOString()
    const session: ChatSession = {
      id: randomUUID(),
      title: 'New chat',
      createdAt: now,
      updatedAt: now,
      uiMessages: [],
      history: [],
      origin: 'desktop'
    }
    sessions = [session]
    activeSessionId = session.id
    telegramActiveSessionId = null
  }

  sessionsCache = sessions
  activeSessionIdCache = activeSessionId
  telegramActiveSessionIdCache = telegramActiveSessionId
  scheduleSessionsPersist()
  return getSessionsState()
}

export function getSkillEnabledMap(): Record<string, boolean> {
  return { ...store.get('skillEnabled', {}) }
}

export function setSkillEnabledFlag(id: string, enabled: boolean): void {
  const map = getSkillEnabledMap()
  map[id] = enabled
  store.set('skillEnabled', map)
}

export function removeSkillEnabledFlag(id: string): void {
  const map = getSkillEnabledMap()
  delete map[id]
  store.set('skillEnabled', map)
}

export function ensureActiveSession(): SessionsState {
  ensureDesktopSessionExists()
  const state = getSessionsState()
  if (!state.activeSessionId) {
    const desktopSessions = state.sessions.filter(isDesktopSession)
    const nextActive = desktopSessions[0]?.id ?? state.sessions[0]?.id ?? null
    if (nextActive) {
      store.set('activeSessionId', nextActive)
      activeSessionIdCache = nextActive
      migrateActiveSessionImages()
      return getSessionsState()
    }
    createSession('desktop')
    migrateActiveSessionImages()
    return getSessionsState()
  }
  migrateActiveSessionImages()
  return getSessionsState()
}

export function ensureActiveSessionList(): SessionsListState {
  ensureActiveSession()
  return getSessionsListState()
}

export function ensureTelegramActiveSession(): SessionsState {
  const state = getSessionsState()
  const telegramSessions = state.sessions.filter(isTelegramSession)
  if (
    state.telegramActiveSessionId &&
    telegramSessions.some((s) => s.id === state.telegramActiveSessionId)
  ) {
    return state
  }
  if (telegramSessions.length > 0) {
    store.set('telegramActiveSessionId', telegramSessions[0]!.id)
    return getSessionsState()
  }
  createSession('telegram')
  return getSessionsState()
}

export function listSchedules(): TelegramSchedule[] {
  return [...store.get('schedules', [])]
}

export function getSchedule(id: string): TelegramSchedule | null {
  return listSchedules().find((s) => s.id === id) ?? null
}

export function upsertSchedule(
  schedule: TelegramSchedule
): TelegramSchedule[] {
  const schedules = listSchedules()
  const idx = schedules.findIndex((s) => s.id === schedule.id)
  if (idx >= 0) {
    schedules[idx] = schedule
  } else {
    schedules.push(schedule)
  }
  store.set('schedules', schedules)
  return schedules
}

export function createScheduleRecord(
  input: Omit<TelegramSchedule, 'id' | 'createdAt' | 'updatedAt' | 'enabled'> & {
    enabled?: boolean
  }
): TelegramSchedule {
  const now = new Date().toISOString()
  const schedule: TelegramSchedule = {
    ...input,
    id: randomUUID(),
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now
  }
  upsertSchedule(schedule)
  return schedule
}

export function deleteScheduleRecord(id: string): TelegramSchedule[] {
  const schedules = listSchedules().filter((s) => s.id !== id)
  store.set('schedules', schedules)
  return schedules
}

export function patchScheduleRun(
  id: string,
  patch: Pick<TelegramSchedule, 'lastRunAt' | 'lastRunStatus' | 'lastRunError'>
): TelegramSchedule | null {
  const schedule = getSchedule(id)
  if (!schedule) return null
  const updated: TelegramSchedule = {
    ...schedule,
    ...patch,
    updatedAt: new Date().toISOString()
  }
  upsertSchedule(updated)
  return updated
}
