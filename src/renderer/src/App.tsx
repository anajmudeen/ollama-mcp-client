import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ActivityPhase,
  AvailableImageModel,
  ChatEvent,
  ChatMessage,
  ChatQueueState,
  SessionSummary,
  SessionsListState,
  LlmProvider,
  McpToolInfo,
  OllamaModel,
  AzureOpenaiDeploymentEntry,
  AzureOpenaiStatus,
  OpenAiStatus,
  ScheduleNotificationPayload,
  SessionQueueStatus,
  TelegramStatus,
  UiMessage,
  ImageBackendSelection
} from '../../shared/types'
import { selectedModelForProvider } from '../../shared/provider-selection'
import {
  normalizeReasoningEffort,
  type ReasoningEffort
} from '../../shared/reasoning-effort'
import type { ServerWithStatus } from '../../preload/index'
import type { ActivityState } from './components/ActivityIndicator'
import { Chat } from './components/Chat'
import { ImageGeneration } from './components/ImageGeneration'
import { McpCatalogPage } from './components/McpCatalogPage'
import { ModelsPage } from './components/ModelsPage'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { SchedulesPage } from './components/SchedulesPage'
import { SkillsPage } from './components/SkillsPage'
import {
  applyBackgroundChatEvent,
  createBackgroundSessionTurn,
  type BackgroundSessionTurn
} from './lib/backgroundChatEvents'
import {
  closeStreamingThinking,
  closeToolMessage,
  segmentDurationMs
} from './lib/segmentTiming'

function uid(): string {
  return crypto.randomUUID()
}

function nowIso(): string {
  return new Date().toISOString()
}

const IDLE_ACTIVITY: ActivityState = { phase: 'idle' }

function sessionQueueStatus(
  sessionId: string,
  state: ChatQueueState
): SessionQueueStatus {
  if (state.running?.sessionId === sessionId) return 'running'
  if (state.queued.some((q) => q.sessionId === sessionId)) return 'queued'
  return 'idle'
}

function titleFromPrompt(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'New chat'
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned
}

type SessionPersistenceSnapshot = {
  id: string
  messages: UiMessage[]
  history: ChatMessage[]
  title: string
}

export default function App(): React.JSX.Element {
  const [servers, setServers] = useState<ServerWithStatus[]>([])
  const [tools, setTools] = useState<McpToolInfo[]>([])
  const [models, setModels] = useState<OllamaModel[]>([])
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [ollamaOk, setOllamaOk] = useState(false)
  const [ollamaError, setOllamaError] = useState<string | undefined>()
  const [imageGenSupported, setImageGenSupported] = useState(true)
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:11434')
  const [llmProvider, setLlmProvider] = useState<LlmProvider>('ollama')
  const [openaiEnabled, setOpenaiEnabled] = useState(false)
  const [openaiApiKeyDraft, setOpenaiApiKeyDraft] = useState('')
  const [openaiStatus, setOpenaiStatus] = useState<OpenAiStatus>({
    enabled: false,
    validationOk: false,
    validationError: null,
    catalogCount: 0,
    enabledCount: 0
  })
  const [openaiCatalog, setOpenaiCatalog] = useState<
    import('../../shared/types').OpenAiModelEntry[]
  >([])
  const [openaiModelEnabled, setOpenaiModelEnabled] = useState<Record<string, boolean>>(
    {}
  )
  const [selectedOpenAiModel, setSelectedOpenAiModel] = useState<string | null>(null)
  const [azureOpenaiEnabled, setAzureOpenaiEnabled] = useState(false)
  const [azureOpenaiApiKeyDraft, setAzureOpenaiApiKeyDraft] = useState('')
  const [azureOpenaiEndpoint, setAzureOpenaiEndpoint] = useState('')
  const [azureOpenaiApiVersion, setAzureOpenaiApiVersion] = useState('2024-10-21')
  const [azureOpenaiStatus, setAzureOpenaiStatus] = useState<AzureOpenaiStatus>({
    enabled: false,
    validationOk: false,
    validationError: null,
    catalogCount: 0,
    enabledCount: 0,
    deploymentCount: 0,
    enabledDeploymentCount: 0
  })
  const [azureOpenaiDeployments, setAzureOpenaiDeployments] = useState<
    AzureOpenaiDeploymentEntry[]
  >([])
  const [selectedAzureOpenaiModel, setSelectedAzureOpenaiModel] = useState<string | null>(null)
  const [effectiveProvider, setEffectiveProvider] = useState<LlmProvider>('ollama')
  const [providerFallbackReason, setProviderFallbackReason] = useState<string | undefined>()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState<ActivityState>(IDLE_ACTIVITY)
  const [showThinking, setShowThinking] = useState(false)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('low')
  const [maxToolIterations, setMaxToolIterations] = useState(30)
  const [imageBackend, setImageBackend] = useState<ImageBackendSelection | null>(null)
  const [availableImageModels, setAvailableImageModels] = useState<AvailableImageModel[]>([])
  const [telegramEnabled, setTelegramEnabled] = useState(false)
  const [telegramAllowedUserIds, setTelegramAllowedUserIds] = useState<number[]>(
    []
  )
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus>({
    running: false
  })
  const [telegramTokenDraft, setTelegramTokenDraft] = useState('')
  const [view, setView] = useState<
    'chat' | 'image' | 'models' | 'mcp' | 'skills' | 'schedules' | 'settings'
  >('chat')
  const [modelsVisited, setModelsVisited] = useState(false)
  const [mcpVisited, setMcpVisited] = useState(false)
  const [skillsVisited, setSkillsVisited] = useState(false)
  const [schedulesVisited, setSchedulesVisited] = useState(false)
  const [settingsVisited, setSettingsVisited] = useState(false)
  const [scheduleToast, setScheduleToast] = useState<ScheduleNotificationPayload | null>(
    null
  )
  const [queueState, setQueueState] = useState<ChatQueueState>({
    running: null,
    queued: []
  })
  const [contextUsage, setContextUsage] = useState<{
    used: number
    limit: number
  } | null>(null)

  const historyRef = useRef<ChatMessage[]>([])
  const messagesRef = useRef<UiMessage[]>([])
  const activeSessionIdRef = useRef<string | null>(null)
  const sessionTitleRef = useRef('New chat')
  const persistTimer = useRef<number | null>(null)
  /** Bumped on switch/new/abort so late stream events never touch another session. */
  const chatEpochRef = useRef(0)
  const activeTurnIdRef = useRef<string | null>(null)
  const turnStartedAtRef = useRef<number | null>(null)
  const turnModelRef = useRef<string | null>(null)
  const selectedModelRef = useRef<string | null>(null)
  const showThinkingRef = useRef(false)
  const sessionsRef = useRef<SessionSummary[]>([])
  const backgroundSessionsRef = useRef<Map<string, BackgroundSessionTurn>>(new Map())
  const writeSessionRef = useRef<
    (
      id: string,
      uiMessages: UiMessage[],
      history: ChatMessage[],
      title?: string
    ) => Promise<void>
  >(async () => {})
  const persistSessionRef = useRef<
    (
      id: string,
      uiMessages: UiMessage[],
      history: ChatMessage[],
      title?: string
    ) => void
  >(() => {})
  const pendingAiTitleRef = useRef<{
    sessionId: string
    prompt: string
    turnId: string
  } | null>(null)
  const titleGenEpochRef = useRef(0)
  const requestAiTitleRef = useRef<() => void>(() => {})
  /** Coalesce high-frequency stream IPC so React does not nest 50+ setStates. */
  const streamBufRef = useRef<{
    thinking: string
    chunk: string
    sessionId: string | null
    turnId: string | null
    raf: number | null
  }>({
    thinking: '',
    chunk: '',
    sessionId: null,
    turnId: null,
    raf: null
  })
  const queueStateRef = useRef<ChatQueueState>({ running: null, queued: [] })
  const modelRefreshRequestRef = useRef(0)
  const imageDiscoveryGenerationRef = useRef(0)
  const beginProviderOperation = useCallback((): number => {
    modelRefreshRequestRef.current += 1
    return modelRefreshRequestRef.current
  }, [])

  const syncMessages = useCallback((next: UiMessage[]) => {
    messagesRef.current = next
    setMessages(next)
  }, [])

  const applySessionsList = useCallback((state: SessionsListState) => {
    setSessions(state.sessions)
    sessionsRef.current = state.sessions
  }, [])

  const loadSessionBody = useCallback(async (id: string | null): Promise<void> => {
    if (!id) {
      messagesRef.current = []
      setMessages([])
      historyRef.current = []
      sessionTitleRef.current = 'New chat'
      setActiveSessionId(null)
      activeSessionIdRef.current = null
      return
    }
    const body = await window.api.sessions.get(id)
    setActiveSessionId(id)
    activeSessionIdRef.current = id
    if (body) {
      messagesRef.current = body.uiMessages
      setMessages(body.uiMessages)
      historyRef.current = body.history
      sessionTitleRef.current = body.title
    } else {
      messagesRef.current = []
      setMessages([])
      historyRef.current = []
      sessionTitleRef.current = 'New chat'
    }
  }, [])

  const writeSession = useCallback(
    async (
      id: string,
      uiMessages: UiMessage[],
      history: ChatMessage[],
      title?: string
    ): Promise<void> => {
      try {
        const patch: Partial<{
          title: string
          uiMessages: UiMessage[]
          history: ChatMessage[]
        }> = {
          uiMessages,
          history
        }
        if (title !== undefined) patch.title = title
        const summary = await window.api.sessions.update(id, patch)
        // Refresh list metadata only — never reload the open chat from this response
        // (that races with an in-progress switch).
        setSessions((prev) => {
          const next = prev.map((s) => (s.id === summary.id ? summary : s))
          const has = next.some((s) => s.id === summary.id)
          const merged = has ? next : [summary, ...next]
          sessionsRef.current = merged
          return merged
        })
      } catch (err) {
        console.error('Failed to persist session', err)
      }
    },
    []
  )

  const persistSession = useCallback(
    (
      id: string,
      uiMessages: UiMessage[],
      history: ChatMessage[],
      title?: string
    ) => {
      if (!id) return
      if (title !== undefined && id === activeSessionIdRef.current) {
        sessionTitleRef.current = title
      }

      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current)
      }
      persistTimer.current = window.setTimeout(() => {
        persistTimer.current = null
        const titleNow =
          id === activeSessionIdRef.current
            ? sessionTitleRef.current
            : undefined
        void writeSession(id, uiMessages, history, titleNow)
      }, 250)
    },
    [writeSession]
  )

  useEffect(() => {
    persistSessionRef.current = persistSession
  }, [persistSession])

  const applyGeneratedTitle = useCallback((id: string, title: string) => {
    setSessions((prev) =>
      prev.map((session) => (session.id === id ? { ...session, title } : session))
    )
    if (id === activeSessionIdRef.current) {
      sessionTitleRef.current = title
    }
  }, [])

  const requestAiTitle = useCallback((): void => {
    const pending = pendingAiTitleRef.current
    if (!pending) return
    pendingAiTitleRef.current = null
    const epoch = titleGenEpochRef.current
    void (async () => {
      try {
        const title = await window.api.sessions.generateTitle(
          pending.sessionId,
          pending.prompt
        )
        if (epoch !== titleGenEpochRef.current) return
        applyGeneratedTitle(pending.sessionId, title)
      } catch (err) {
        console.error('Failed to generate session title', err)
      }
    })()
  }, [applyGeneratedTitle])

  const cancelAiTitle = useCallback((): void => {
    pendingAiTitleRef.current = null
    titleGenEpochRef.current += 1
  }, [])

  useEffect(() => {
    requestAiTitleRef.current = requestAiTitle
  }, [requestAiTitle])

  useEffect(() => {
    showThinkingRef.current = showThinking
  }, [showThinking])

  useEffect(() => {
    selectedModelRef.current = selectedModel
  }, [selectedModel])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    writeSessionRef.current = writeSession
  }, [writeSession])

  const flushActiveSession = useCallback(async (): Promise<void> => {
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current)
      persistTimer.current = null
    }
    const id = activeSessionIdRef.current
    if (!id) return
    await writeSession(
      id,
      messagesRef.current,
      historyRef.current,
      sessionTitleRef.current
    )
  }, [writeSession])

  const bumpChatEpoch = useCallback(() => {
    chatEpochRef.current += 1
    const buf = streamBufRef.current
    if (buf.raf != null) {
      window.cancelAnimationFrame(buf.raf)
      buf.raf = null
    }
    buf.thinking = ''
    buf.chunk = ''
    buf.sessionId = null
    buf.turnId = null
  }, [])

  const refreshServers = useCallback(async () => {
    const list = await window.api.mcp.listServers()
    setServers(list)
    const t = await window.api.mcp.listTools()
    setTools(t)
  }, [])

  const refreshOpenAiStatus = useCallback(async (requestId?: number) => {
    const status = await window.api.openai.getStatus()
    if (
      requestId !== undefined &&
      requestId !== modelRefreshRequestRef.current
    ) {
      return
    }
    setOpenaiStatus(status)
  }, [])

  const refreshAvailableImageModels = useCallback(async (): Promise<void> => {
    const generation = ++imageDiscoveryGenerationRef.current
    const isCurrent = (): boolean =>
      generation === imageDiscoveryGenerationRef.current
    try {
      const discovery = await window.api.images.listAvailableModels()
      if (!isCurrent()) return
      const available = discovery.models
      const migrated = await window.api.images.migrateLegacyBackend(available)
      if (!isCurrent()) return
      const config = await window.api.getConfig()
      if (!isCurrent()) return
      const selected = migrated ?? config.imageBackend
      const preserved = selected &&
        available.some(
          (entry) =>
            entry.provider === selected.provider && entry.model === selected.model
        )
        ? selected
        : null
      if (selected && !preserved) {
        await window.api.setImageBackend(null)
        if (!isCurrent()) return
      }
      if (!isCurrent()) return
      setAvailableImageModels(available)
      setImageBackend(preserved)
    } catch {
      if (!isCurrent()) return
      setAvailableImageModels([])
      setImageBackend(null)
    }
  }, [])

  const refreshEffectiveProvider = useCallback(async (requestId?: number) => {
    const status = await window.api.llm.getEffectiveProvider()
    if (
      requestId !== undefined &&
      requestId !== modelRefreshRequestRef.current
    ) {
      return null
    }
    setEffectiveProvider(status.effective)
    setProviderFallbackReason(status.fallback ? status.reason : undefined)
    return status
  }, [])

  const refreshModelsForProvider = useCallback(
    async (provider: LlmProvider, requestId = ++modelRefreshRequestRef.current) => {
      const isCurrentRequest = (): boolean =>
        requestId === modelRefreshRequestRef.current

      if (provider === 'openai' || provider === 'azure-openai') {
        try {
          const list =
            provider === 'openai'
              ? await window.api.openai.listChatModels()
              : await window.api.azureOpenai.listChatModels()
          const names = list.map((m) => m.name)
          const config = await window.api.getConfig()
          if (!isCurrentRequest()) return
          const saved = config.selectedModelByProvider[provider]
          const next = saved && names.includes(saved) ? saved : names[0] ?? null
          if (!saved || !names.includes(saved)) {
            await window.api.setSelectedModelForProvider(provider, next)
            if (!isCurrentRequest()) return
          }
          if (!isCurrentRequest()) return
          setModels(list)
          setSelectedModel(next)
        } catch {
          if (!isCurrentRequest()) return
          setModels([])
          setSelectedModel(null)
        }
        try {
          const status = await window.api.ollama.getStatus()
          if (!isCurrentRequest()) return
          const ollamaList = status.ok ? await window.api.ollama.listModels() : []
          if (!isCurrentRequest()) return
          setOllamaModels(ollamaList)
        } catch {
          if (!isCurrentRequest()) return
          setOllamaModels([])
        }
        return
      }
      const status = await window.api.ollama.getStatus()
      if (!isCurrentRequest()) return
      if (!status.ok) {
        setOllamaModels([])
        setModels([])
        return
      }
      const list = await window.api.ollama.listModels()
      const names = list.map((m) => m.name)
      const config = await window.api.getConfig()
      if (!isCurrentRequest()) return
      const saved = config.selectedModelByProvider.ollama
      const next = saved && names.includes(saved) ? saved : names[0] ?? null
      setSelectedModel(next)
      if (!saved || !names.includes(saved)) {
        await window.api.setSelectedModelForProvider('ollama', next)
        if (!isCurrentRequest()) return
      }
      if (!isCurrentRequest()) return
      setOllamaModels(list)
      setModels(list)
      setSelectedModel(next)
    },
    []
  )

  const applyConfig = useCallback(
    async (
      config: Awaited<ReturnType<typeof window.api.getConfig>>,
      requestId = beginProviderOperation()
    ) => {
      if (requestId !== modelRefreshRequestRef.current) return
      setBaseUrl(config.ollamaBaseUrl)
      setLlmProvider(config.llmProvider)
      setOpenaiEnabled(config.openaiEnabled)
      setOpenaiApiKeyDraft(config.openaiApiKey ?? '')
      setOpenaiCatalog(config.openaiModelsCatalog)
      setOpenaiModelEnabled(config.openaiModelEnabled)
      setSelectedOpenAiModel(config.selectedModelByProvider.openai)
      setAzureOpenaiEnabled(config.azureOpenaiEnabled)
      setAzureOpenaiApiKeyDraft(config.azureOpenaiApiKey ?? '')
      setAzureOpenaiEndpoint(config.azureOpenaiEndpoint ?? '')
      setAzureOpenaiApiVersion(config.azureOpenaiApiVersion || '2024-10-21')
      setAzureOpenaiDeployments(config.azureOpenaiDeployments)
      setSelectedAzureOpenaiModel(config.selectedModelByProvider['azure-openai'])
      setSelectedModel(config.selectedModel)
      setShowThinking(Boolean(config.showThinking))
      showThinkingRef.current = Boolean(config.showThinking)
      setReasoningEffort(normalizeReasoningEffort(config.reasoningEffort))
      setMaxToolIterations(config.maxToolIterations)
      setImageBackend(config.imageBackend ?? null)
      setTelegramEnabled(Boolean(config.telegramEnabled))
      setTelegramAllowedUserIds(config.telegramAllowedUserIds)
      setTelegramTokenDraft(config.telegramBotToken ?? '')
      await refreshOpenAiStatus(requestId)
      if (requestId !== modelRefreshRequestRef.current) return
      const azureStatus = await window.api.azureOpenai.getStatus()
      if (requestId !== modelRefreshRequestRef.current) return
      setAzureOpenaiStatus(azureStatus)
      const effectiveStatus = await refreshEffectiveProvider(requestId)
      if (!effectiveStatus || requestId !== modelRefreshRequestRef.current) return
      await refreshModelsForProvider(effectiveStatus.effective, requestId)
      await refreshAvailableImageModels()
    },
    [
      beginProviderOperation,
      refreshEffectiveProvider,
      refreshModelsForProvider,
      refreshOpenAiStatus,
      refreshAvailableImageModels
    ]
  )

  const refreshOllama = useCallback(async (requestId = beginProviderOperation()) => {
    const status = await window.api.ollama.getStatus()
    if (requestId !== modelRefreshRequestRef.current) return
    setOllamaOk(status.ok)
    setOllamaError(status.error)
    setBaseUrl(status.baseUrl)
    setImageGenSupported(status.imageGenSupported !== false)
    if (status.ok) {
      try {
        const list = await window.api.ollama.listModels()
        if (requestId !== modelRefreshRequestRef.current) return
        setOllamaModels(list)
        if (llmProvider === 'ollama') {
          setModels(list)
          const names = list.map((m) => m.name)
          const config = await window.api.getConfig()
          if (requestId !== modelRefreshRequestRef.current) return
          const saved = config.selectedModelByProvider.ollama
          const next = saved && names.includes(saved) ? saved : names[0] ?? null
          if (!saved || !names.includes(saved)) {
            await window.api.setSelectedModelForProvider('ollama', next)
            if (requestId !== modelRefreshRequestRef.current) return
          }
          setSelectedModel(next)
        }
      } catch (err) {
        if (requestId !== modelRefreshRequestRef.current) return
        setOllamaModels([])
        setOllamaOk(false)
        setOllamaError(err instanceof Error ? err.message : String(err))
      }
    } else {
      if (requestId !== modelRefreshRequestRef.current) return
      setOllamaModels([])
      setModels([])
    }
      await refreshAvailableImageModels()
  }, [beginProviderOperation, llmProvider, refreshAvailableImageModels])

  useEffect(() => {
    void (async () => {
      const requestId = beginProviderOperation()
      const config = await window.api.getConfig()
      setTelegramStatus(await window.api.telegram.getStatus())
      const sessionState = await window.api.sessions.list()
      applySessionsList(sessionState)
      await loadSessionBody(sessionState.activeSessionId)
      await refreshServers()
      await applyConfig(config, requestId)
      const status = await window.api.ollama.getStatus()
      if (requestId !== modelRefreshRequestRef.current) return
      setOllamaOk(status.ok)
      setOllamaError(status.error)
      setImageGenSupported(status.imageGenSupported !== false)
    })()
  }, [
    applyConfig,
    applySessionsList,
    beginProviderOperation,
    loadSessionBody,
    refreshServers
  ])

  useEffect(() => {
    queueStateRef.current = queueState
  }, [queueState])

  const clearQueuedLabels = useCallback((sessionId: string): void => {
    if (sessionId !== activeSessionIdRef.current) return
    const next = messagesRef.current.map((m) =>
      m.kind === 'user' && m.queueStatus === 'queued'
        ? { ...m, queueStatus: undefined }
        : m
    )
    syncMessages(next)
    persistSessionRef.current(sessionId, next, historyRef.current)
  }, [syncMessages])

  const adoptRunningTurn = useCallback(
    (sessionId: string, turnId: string): void => {
      if (sessionId !== activeSessionIdRef.current) return
      activeTurnIdRef.current = turnId
      turnStartedAtRef.current = Date.now()
      turnModelRef.current = selectedModelRef.current
      setBusy(true)
      setActivity({
        phase: 'thinking',
        detail: 'Waiting for the model…',
        thinking: '',
        startedAt: Date.now()
      })
      clearQueuedLabels(sessionId)
    },
    [clearQueuedLabels]
  )

  useEffect(() => {
    void window.api.queue.getState().then((state) => {
      setQueueState(state)
      queueStateRef.current = state
    })
    const unsubQueue = window.api.queue.onChanged((state) => {
      setQueueState(state)
      queueStateRef.current = state
      const activeId = activeSessionIdRef.current
      if (activeId && state.running?.sessionId === activeId) {
        adoptRunningTurn(activeId, state.running.turnId)
      }
    })
    return unsubQueue
  }, [adoptRunningTurn])

  useEffect(() => {
    const unsubSchedules = window.api.schedules.onNotification((payload) => {
      setScheduleToast(payload)
    })

    const unsub = window.api.sessions.onChanged((state) => {
      // Summaries only — never replace open-chat messages from broadcast.
      applySessionsList(state)
      const activeId = activeSessionIdRef.current
      if (activeId && !state.sessions.some((s) => s.id === activeId)) {
        void loadSessionBody(state.activeSessionId)
      } else if (!activeId && state.activeSessionId) {
        void loadSessionBody(state.activeSessionId)
      } else if (activeId) {
        const summary = state.sessions.find((s) => s.id === activeId)
        if (summary) sessionTitleRef.current = summary.title
        setActiveSessionId(activeId)
      }
    })
    return () => {
      unsubSchedules()
      unsub()
    }
  }, [applySessionsList, loadSessionBody])

  useEffect(() => {
    if (!scheduleToast) return
    const timer = window.setTimeout(() => setScheduleToast(null), 8000)
    return () => window.clearTimeout(timer)
  }, [scheduleToast])

  useEffect(() => {
    const buf = streamBufRef.current

    const applyThinkingDelta = (content: string): void => {
      setActivity((prev) => ({
        ...prev,
        phase: 'thinking',
        detail: prev.detail ?? 'Model is reasoning…',
        thinking: (prev.thinking ?? '') + content,
        startedAt: prev.startedAt ?? Date.now()
      }))
      if (!showThinkingRef.current) return
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.kind === 'thinking' && last.streaming) {
          next[next.length - 1] = {
            ...last,
            content: last.content + content
          }
        } else {
          next.push({
            kind: 'thinking',
            id: uid(),
            content,
            createdAt: nowIso(),
            streaming: true,
            model: turnModelRef.current ?? undefined,
            startedAt: Date.now()
          })
        }
        messagesRef.current = next
        return next
      })
    }

    const applyChunkDelta = (content: string): void => {
      setActivity((prev) =>
        prev.phase === 'generating'
          ? prev
          : {
              ...prev,
              phase: 'generating' as ActivityPhase,
              detail: 'Writing a reply…',
              startedAt: prev.startedAt ?? Date.now()
            }
      )
      setMessages((prev) => {
        let next = closeStreamingThinking(prev, turnStartedAtRef.current)
        next = [...next]
        const last = next[next.length - 1]
        if (last?.kind === 'assistant' && last.streaming) {
          next[next.length - 1] = {
            ...last,
            content: last.content + content
          }
        } else {
          next.push({
            kind: 'assistant',
            id: uid(),
            content,
            createdAt: nowIso(),
            streaming: true,
            model: turnModelRef.current ?? undefined,
            startedAt: Date.now()
          })
        }
        messagesRef.current = next
        return next
      })
    }

    const flushStreamBuf = (): void => {
      if (buf.raf != null) {
        window.cancelAnimationFrame(buf.raf)
        buf.raf = null
      }
      const thinking = buf.thinking
      const chunk = buf.chunk
      const sessionId = buf.sessionId
      const turnId = buf.turnId
      buf.thinking = ''
      buf.chunk = ''
      if (!thinking && !chunk) return
      if (!sessionId || !turnId) return
      if (sessionId !== activeSessionIdRef.current) return
      if (turnId !== activeTurnIdRef.current) return
      if (thinking) applyThinkingDelta(thinking)
      if (chunk) applyChunkDelta(chunk)
    }

    const scheduleStreamFlush = (sessionId: string, turnId: string): void => {
      buf.sessionId = sessionId
      buf.turnId = turnId
      if (buf.raf != null) return
      buf.raf = window.requestAnimationFrame(flushStreamBuf)
    }

    const unsub = window.api.chat.onEvent((event: ChatEvent) => {
      if (
        (event.type === 'done' || event.type === 'error') &&
        event.turnId &&
        pendingAiTitleRef.current?.turnId === event.turnId
      ) {
        requestAiTitleRef.current()
      }

      const eventSessionId = event.sessionId

      if (event.turnId && eventSessionId) {
        if (eventSessionId !== activeSessionIdRef.current) {
          const applyToBackground = (bg: BackgroundSessionTurn): void => {
            applyBackgroundChatEvent(
              event,
              bg,
              (ui, hist) => {
                void writeSessionRef.current(eventSessionId, ui, hist)
              },
              showThinkingRef.current
            )
            if (event.type === 'done' || event.type === 'error') {
              backgroundSessionsRef.current.delete(eventSessionId)
            }
          }
          const bg = backgroundSessionsRef.current.get(eventSessionId)
          if (bg) {
            applyToBackground(bg)
            return
          }
          // List is summaries-only — hydrate body from main, then apply.
          void window.api.sessions.get(eventSessionId).then((body) => {
            if (!body) return
            if (eventSessionId === activeSessionIdRef.current) return
            let next = backgroundSessionsRef.current.get(eventSessionId)
            if (!next) {
              next = createBackgroundSessionTurn(
                body.uiMessages,
                body.history,
                selectedModelRef.current
              )
              backgroundSessionsRef.current.set(eventSessionId, next)
            }
            applyToBackground(next)
          })
          return
        }
      }

      const sessionId = activeSessionIdRef.current
      if (!sessionId) return

      // Adopt in-flight turns only for the session currently open in the UI.
      if (
        event.turnId &&
        eventSessionId === sessionId &&
        !activeTurnIdRef.current &&
        event.type !== 'user' &&
        event.type !== 'done'
      ) {
        activeTurnIdRef.current = event.turnId
        turnStartedAtRef.current = Date.now()
        turnModelRef.current = selectedModelRef.current
        setBusy(true)
        setActivity({
          phase: 'thinking',
          detail: 'Waiting for the model…',
          thinking: '',
          startedAt: Date.now()
        })
      }

      const turnOk =
        Boolean(event.turnId) &&
        Boolean(activeTurnIdRef.current) &&
        event.turnId === activeTurnIdRef.current &&
        (!eventSessionId || eventSessionId === sessionId)

      const stillCurrent = (): boolean =>
        turnOk && sessionId === activeSessionIdRef.current

      if (event.type === 'thinking' || event.type === 'chunk') {
        if (!stillCurrent() || !event.turnId) return
        if (event.type === 'thinking') buf.thinking += event.content
        else buf.chunk += event.content
        scheduleStreamFlush(sessionId, event.turnId)
        return
      }

      flushStreamBuf()

      const endBusy = (): void => {
        if (!turnOk) return
        setBusy(false)
        setActivity(IDLE_ACTIVITY)
        // Keep activeTurnId until `done` so a follow-up done event still matches.
        if (event.type === 'done' || event.type === 'error') {
          activeTurnIdRef.current = null
        }
      }

      if (event.type === 'status') {
        if (!stillCurrent()) return
        setActivity((prev) => ({
          phase: event.phase,
          detail: event.detail,
          thinking: prev.thinking,
          startedAt: prev.startedAt ?? Date.now()
        }))
      } else if (event.type === 'assistant_done') {
        if (!stillCurrent()) return
        endBusy()
        if (event.content) {
          const last = historyRef.current[historyRef.current.length - 1]
          if (
            last?.role !== 'assistant' ||
            last.content !== event.content
          ) {
            historyRef.current = [
              ...historyRef.current,
              { role: 'assistant', content: event.content }
            ]
          }
        }
        const historySnapshot = historyRef.current
        const responseMs =
          turnStartedAtRef.current != null
            ? Date.now() - turnStartedAtRef.current
            : undefined
        const finishedAt = nowIso()
        setMessages((prev) => {
          if (sessionId !== activeSessionIdRef.current) return prev
          const next = closeStreamingThinking(prev, turnStartedAtRef.current)
          const last = next[next.length - 1]
          if (last?.kind === 'assistant' && last.streaming) {
            next[next.length - 1] = {
              ...last,
              content: event.content || last.content,
              streaming: false,
              createdAt: finishedAt,
              durationMs: segmentDurationMs(last.startedAt),
              responseMs,
              contextUsed: event.contextUsed ?? last.contextUsed,
              contextLimit: event.contextLimit ?? last.contextLimit,
              tokensPerSec: event.tokensPerSec ?? last.tokensPerSec,
              tokenUsage: event.tokenUsage ?? last.tokenUsage,
              multiCallTurn: event.multiCallTurn ?? last.multiCallTurn,
              reasoningEffort: event.reasoningEffort ?? last.reasoningEffort
            }
          } else if (event.content) {
            next.push({
              kind: 'assistant',
              id: uid(),
              content: event.content,
              createdAt: finishedAt,
              streaming: false,
              responseMs,
              model: turnModelRef.current ?? undefined,
              contextUsed: event.contextUsed,
              contextLimit: event.contextLimit,
              tokensPerSec: event.tokensPerSec,
              tokenUsage: event.tokenUsage,
              multiCallTurn: event.multiCallTurn,
              reasoningEffort: event.reasoningEffort
            })
          }
          messagesRef.current = next
          persistSessionRef.current(sessionId, next, historySnapshot)
          return next
        })
      } else if (event.type === 'assistant_images') {
        if (!stillCurrent()) return
        endBusy()
        const mime = event.mime ?? 'image/png'
        const dataUrls = event.images.map((b64) =>
          b64.startsWith('data:') ? b64 : `data:${mime};base64,${b64}`
        )
        historyRef.current = [
          ...historyRef.current,
          {
            role: 'assistant',
            content: 'An image was generated and displayed to the user.'
          }
        ]
        const historySnapshot = historyRef.current
        const responseMs =
          turnStartedAtRef.current != null
            ? Date.now() - turnStartedAtRef.current
            : undefined
        const finishedAt = nowIso()
        setMessages((prev) => {
          if (sessionId !== activeSessionIdRef.current) return prev
          const next = closeStreamingThinking(prev, turnStartedAtRef.current)
          const last = next[next.length - 1]
          if (last?.kind === 'assistant' && last.streaming) {
            next[next.length - 1] = {
              ...last,
              content: last.content || '',
              images: dataUrls,
              imageModel: event.imageModel,
              streaming: false,
              createdAt: finishedAt,
              durationMs: segmentDurationMs(last.startedAt),
              responseMs,
              contextUsed: event.contextUsed ?? last.contextUsed,
              contextLimit: event.contextLimit ?? last.contextLimit,
              tokenUsage: event.tokenUsage ?? last.tokenUsage
            }
          } else {
            next.push({
              kind: 'assistant',
              id: uid(),
              content: '',
              images: dataUrls,
              imageModel: event.imageModel,
              createdAt: finishedAt,
              streaming: false,
              responseMs,
              model: turnModelRef.current ?? undefined,
              contextUsed: event.contextUsed,
              contextLimit: event.contextLimit,
              tokenUsage: event.tokenUsage
            })
          }
          messagesRef.current = next
          persistSessionRef.current(sessionId, next, historySnapshot)
          return next
        })
      } else if (event.type === 'tool_start') {
        if (!stillCurrent()) return
        setActivity((prev) => ({
          phase: 'tool',
          detail: `Calling ${event.name.includes('__') ? event.name.split('__').slice(1).join('__') : event.name}…`,
          thinking: prev.thinking,
          startedAt: prev.startedAt ?? Date.now()
        }))
        setMessages((prev) => {
          if (!stillCurrent()) return prev
          const closed = closeStreamingThinking(prev, turnStartedAtRef.current)
          const last = closed[closed.length - 1]
          const responseMs =
            turnStartedAtRef.current != null
              ? Date.now() - turnStartedAtRef.current
              : undefined
          const withClosed =
            last?.kind === 'assistant' && last.streaming
              ? [
                  ...closed.slice(0, -1),
                  {
                    ...last,
                    streaming: false,
                    createdAt: nowIso(),
                    durationMs: segmentDurationMs(last.startedAt),
                    responseMs: last.responseMs ?? responseMs
                  }
                ]
              : [...closed]
          withClosed.push({
            kind: 'tool',
            id: event.id,
            name: event.name,
            arguments: event.arguments,
            status: 'running',
            createdAt: nowIso(),
            model: turnModelRef.current ?? undefined,
            startedAt: Date.now()
          })
          messagesRef.current = withClosed
          persistSessionRef.current(sessionId, withClosed, historyRef.current)
          return withClosed
        })
      } else if (event.type === 'tool_result') {
        if (!stillCurrent()) return
        setMessages((prev) => {
          if (!stillCurrent()) return prev
          const next = prev.map((m) =>
            m.kind === 'tool' && m.id === event.id
              ? closeToolMessage(
                  {
                    ...m,
                    status: event.ok ? ('done' as const) : ('error' as const),
                    result: event.result,
                    images: event.images,
                    imageModel: event.imageModel,
                    mime: event.mime
                  },
                  turnStartedAtRef.current
                )
              : m
          )
          messagesRef.current = next
          persistSessionRef.current(sessionId, next, historyRef.current)
          return next
        })
      } else if (event.type === 'error') {
        if (!stillCurrent()) return
        endBusy()
        if (event.message === 'Aborted') return
        setMessages((prev) => {
          if (sessionId !== activeSessionIdRef.current) return prev
          const next = [
            ...prev,
            {
              kind: 'error' as const,
              id: uid(),
              content: event.message,
              createdAt: nowIso(),
              model: turnModelRef.current ?? undefined
            }
          ]
          messagesRef.current = next
          persistSessionRef.current(sessionId, next, historyRef.current)
          return next
        })
      } else if (event.type === 'context') {
        if (!stillCurrent()) return
        setContextUsage({
          used: event.used,
          limit: event.limit
        })
      } else if (event.type === 'compacted') {
        if (!stillCurrent()) return
        historyRef.current = event.messages
        persistSessionRef.current(
          sessionId,
          messagesRef.current,
          event.messages
        )
      } else if (event.type === 'provider_fallback') {
        if (!stillCurrent()) return
        setMessages((prev) => {
          if (!stillCurrent()) return prev
          const notice = {
            kind: 'notice' as const,
            id: uid(),
            content: event.message,
            createdAt: nowIso()
          }
          const next = [...prev, notice]
          messagesRef.current = next
          persistSessionRef.current(sessionId, next, historyRef.current)
          return next
        })
      } else if (event.type === 'notice') {
        if (!stillCurrent()) return
        setMessages((prev) => {
          if (!stillCurrent()) return prev
          const notice = {
            kind: 'notice' as const,
            id: uid(),
            content: event.content,
            createdAt: nowIso(),
            summary: event.summary
          }
          const next = [...prev, notice]
          messagesRef.current = next
          persistSessionRef.current(sessionId, next, historyRef.current)
          return next
        })
      } else if (event.type === 'done') {
        if (!stillCurrent()) return
        endBusy()
        const responseMs =
          turnStartedAtRef.current != null
            ? Date.now() - turnStartedAtRef.current
            : undefined
        const finishedAt = nowIso()
        setMessages((prev) => {
          if (sessionId !== activeSessionIdRef.current) return prev
          const next = closeStreamingThinking(
            prev.map((m) =>
              m.kind === 'assistant' && m.streaming
                ? {
                    ...m,
                    streaming: false,
                    createdAt: finishedAt,
                    durationMs: segmentDurationMs(m.startedAt),
                    responseMs: m.responseMs ?? responseMs
                  }
                : m
            ),
            turnStartedAtRef.current
          )
          messagesRef.current = next
          persistSessionRef.current(sessionId, next, historyRef.current)
          return next
        })
      }
    })
    return () => {
      if (buf.raf != null) {
        window.cancelAnimationFrame(buf.raf)
        buf.raf = null
      }
      unsub()
    }
  }, [])

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const activeSessionReadOnly = (activeSession?.origin ?? 'desktop') === 'telegram'
  const activeSessionQueueStatus = activeSessionId
    ? sessionQueueStatus(activeSessionId, queueState)
    : 'idle'

  const handleSend = async (payload: {
    content: string
    images?: string[]
    imageMimes?: string[]
    displayImages?: string[]
    attachmentLabels?: string[]
    invokedSkill?: string
  }): Promise<void> => {
    if (!selectedModel) return
    if (activeSessionReadOnly) return
    if (!payload.content.trim() && !payload.images?.length) return
    const sessionId = activeSessionIdRef.current
    if (!sessionId) return
    if (sessionQueueStatus(sessionId, queueStateRef.current) !== 'idle') return

    const willQueue = queueStateRef.current.running !== null
    const turnId = uid()

    const userMsg: ChatMessage = {
      role: 'user',
      content: payload.content,
      images: payload.images,
      imageMimes: payload.imageMimes
    }
    const nextHistory = [...historyRef.current, userMsg]
    historyRef.current = nextHistory

    const promptOnly = payload.content.split(/\n\nAttached file:/)[0]?.trim() ?? ''
    const uiContent =
      promptOnly && !promptOnly.startsWith('Attached file:')
        ? promptOnly
        : payload.attachmentLabels?.length
          ? payload.content.startsWith('Please review the attached')
            ? payload.content
            : `Sent ${payload.attachmentLabels.length} file(s)`
          : payload.content
    const nextMessages: UiMessage[] = [
      ...messagesRef.current,
      {
        kind: 'user',
        id: uid(),
        content: uiContent,
        createdAt: nowIso(),
        attachmentLabels: payload.attachmentLabels,
        images: payload.displayImages,
        model: selectedModel,
        ...(willQueue ? { queueStatus: 'queued' as const } : {})
      }
    ]
    syncMessages(nextMessages)

    let title = sessionTitleRef.current
    if (title === 'New chat') {
      title = titleFromPrompt(uiContent)
      sessionTitleRef.current = title
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId ? { ...session, title } : session
        )
      )
      pendingAiTitleRef.current = {
        sessionId,
        prompt: uiContent,
        turnId
      }
    }
    persistSession(sessionId, nextMessages, nextHistory, title)

    if (!willQueue) {
      activeTurnIdRef.current = turnId
      turnStartedAtRef.current = Date.now()
      turnModelRef.current = selectedModel
      setBusy(true)
      setActivity({
        phase: 'thinking',
        detail: 'Waiting for the model…',
        thinking: '',
        startedAt: Date.now()
      })
    }

    const result = await window.api.chat.send({
      model: selectedModel,
      messages: nextHistory,
      sessionId,
      turnId,
      contextUsed: contextUsage?.used,
      invokedSkill: payload.invokedSkill
    })
    if (!result.ok) {
      const reverted = nextMessages.slice(0, -1)
      historyRef.current = historyRef.current.slice(0, -1)
      syncMessages(reverted)
      persistSession(sessionId, reverted, historyRef.current, title)
      return
    }
  }

  const handleAbort = async (): Promise<void> => {
    bumpChatEpoch()
    activeTurnIdRef.current = null
    await window.api.chat.abort()
    setBusy(false)
    setActivity(IDLE_ACTIVITY)
  }

  const handleClear = (): void => {
    if (activeSessionReadOnly) return
    const sessionId = activeSessionIdRef.current
    if (sessionId) void window.api.queue.removeSession(sessionId)
    bumpChatEpoch()
    activeTurnIdRef.current = null
    cancelAiTitle()
    historyRef.current = []
    syncMessages([])
    setBusy(false)
    setActivity(IDLE_ACTIVITY)
    sessionTitleRef.current = 'New chat'
    setContextUsage(null)
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? { ...session, title: 'New chat' } : session
      )
    )
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current)
      persistTimer.current = null
    }
    if (sessionId) void writeSession(sessionId, [], [], 'New chat')
  }

  const leaveCurrentSession = useCallback(
    async (options?: {
      persist?: boolean
    }): Promise<SessionPersistenceSnapshot | null> => {
      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current)
        persistTimer.current = null
      }
      const sessionId = activeSessionIdRef.current
      if (sessionId && activeTurnIdRef.current) {
        backgroundSessionsRef.current.set(
          sessionId,
          createBackgroundSessionTurn(
            messagesRef.current,
            historyRef.current,
            turnModelRef.current
          )
        )
      }
      bumpChatEpoch()
      activeTurnIdRef.current = null
      setBusy(false)
      setActivity(IDLE_ACTIVITY)
      setContextUsage(null)
      const snapshot = sessionId
        ? {
            id: sessionId,
            messages: messagesRef.current,
            history: historyRef.current,
            title: sessionTitleRef.current
          }
        : null
      if (options?.persist !== false) {
        await flushActiveSession()
      }
      return snapshot
    },
    [bumpChatEpoch, flushActiveSession]
  )

  const handleNewSession = async (): Promise<void> => {
    setView('chat')
    const previous = await leaveCurrentSession({ persist: false })
    const state = await window.api.sessions.create()
    applySessionsList(state)
    await loadSessionBody(state.activeSessionId)
    if (previous) {
      void writeSession(
        previous.id,
        previous.messages,
        previous.history,
        previous.title
      )
    }
  }

  const handleSelectSession = async (id: string): Promise<void> => {
    setView('chat')
    if (id === activeSessionIdRef.current) return
    const previous = await leaveCurrentSession({ persist: false })
    const state = await window.api.sessions.setActive(id)
    applySessionsList(state)
    const bg = backgroundSessionsRef.current.get(id)
    if (bg) {
      backgroundSessionsRef.current.delete(id)
      setActiveSessionId(id)
      activeSessionIdRef.current = id
      messagesRef.current = bg.messages
      setMessages(bg.messages)
      historyRef.current = bg.history
      const session = state.sessions.find((s) => s.id === id)
      sessionTitleRef.current = session?.title ?? 'New chat'
    } else {
      await loadSessionBody(id)
    }
    const running = queueStateRef.current.running
    if (running?.sessionId === id) {
      adoptRunningTurn(id, running.turnId)
    }
    if (previous) {
      void writeSession(
        previous.id,
        previous.messages,
        previous.history,
        previous.title
      )
    }
  }

  const handleDeleteSession = async (id: string): Promise<void> => {
    const target = sessions.find((s) => s.id === id)
    if (!target) return
    if (pendingAiTitleRef.current?.sessionId === id) {
      cancelAiTitle()
    }
    const wasActive = id === activeSessionIdRef.current
    if (wasActive) {
      await leaveCurrentSession({ persist: false })
    }
    const state = await window.api.sessions.delete(id)
    applySessionsList(state)
    if (wasActive) {
      await loadSessionBody(state.activeSessionId)
    }
  }

  const handleSelectModel = async (model: string): Promise<void> => {
    setSelectedModel(model)
    setContextUsage(null)
    await window.api.setSelectedModelForProvider(effectiveProvider, model)
    if (effectiveProvider === 'openai') {
      setSelectedOpenAiModel(model)
    } else if (effectiveProvider === 'azure-openai') {
      setSelectedAzureOpenaiModel(model)
    }
  }

  const handleUseOllamaModelInChat = async (model: string): Promise<void> => {
    if (llmProvider !== 'ollama' || !ollamaOk) return
    setSelectedModel(model)
    setContextUsage(null)
    await window.api.setSelectedModelForProvider('ollama', model)
    setView('chat')
  }

  const handleSetBaseUrl = async (url: string): Promise<void> => {
    const saved = await window.api.ollama.setBaseUrl(url)
    setBaseUrl(saved)
    await refreshOllama()
  }

  const handleSetShowThinking = async (enabled: boolean): Promise<void> => {
    setShowThinking(enabled)
    showThinkingRef.current = enabled
    await window.api.setShowThinking(enabled)
  }

  const handleSetReasoningEffort = async (value: ReasoningEffort): Promise<void> => {
    const saved = await window.api.setReasoningEffort(value)
    setReasoningEffort(saved)
  }

  const handleSetMaxToolIterations = async (value: number): Promise<void> => {
    const saved = await window.api.setMaxToolIterations(value)
    setMaxToolIterations(saved)
  }

  const handleSetImageBackend = async (
    selection: ImageBackendSelection | null
  ): Promise<void> => {
    imageDiscoveryGenerationRef.current += 1
    const saved = await window.api.setImageBackend(selection)
    setImageBackend(saved)
  }

  const handleSetTelegramToken = async (token: string | null): Promise<void> => {
    const status = await window.api.telegram.setToken(token)
    setTelegramStatus(status)
    setTelegramTokenDraft(token ?? '')
  }

  const handleSetTelegramEnabled = async (enabled: boolean): Promise<void> => {
    setTelegramEnabled(enabled)
    const status = await window.api.telegram.setEnabled(enabled)
    setTelegramStatus(status)
  }

  const handleSetTelegramAllowedUserIds = async (ids: number[]): Promise<void> => {
    const saved = await window.api.telegram.setAllowedUserIds(ids)
    setTelegramAllowedUserIds(saved)
  }

  const handleSetLlmProvider = async (provider: LlmProvider): Promise<void> => {
    const requestId = beginProviderOperation()
    await window.api.setLlmProvider(provider)
    if (requestId !== modelRefreshRequestRef.current) return
    setLlmProvider(provider)
    const config = await window.api.getConfig()
    if (requestId !== modelRefreshRequestRef.current) return
    setSelectedModel(selectedModelForProvider(config.selectedModelByProvider, provider))
    const effectiveStatus = await refreshEffectiveProvider(requestId)
    if (!effectiveStatus || requestId !== modelRefreshRequestRef.current) return
    await refreshModelsForProvider(effectiveStatus.effective, requestId)
  }

  const handleSetOpenaiEnabled = async (enabled: boolean): Promise<void> => {
    const requestId = beginProviderOperation()
    await window.api.setOpenaiEnabled(enabled)
    if (requestId !== modelRefreshRequestRef.current) return
    setOpenaiEnabled(enabled)
    await refreshOpenAiStatus(requestId)
    await refreshEffectiveProvider(requestId)
  }

  const handleSetOpenaiApiKey = async (key: string | null): Promise<void> => {
    const requestId = beginProviderOperation()
    await window.api.setOpenaiApiKey(key)
    if (requestId !== modelRefreshRequestRef.current) return
    setOpenaiApiKeyDraft(key ?? '')
    await refreshOpenAiStatus(requestId)
    await refreshEffectiveProvider(requestId)
  }

  const refreshAzureConfig = async (requestId: number): Promise<void> => {
    const config = await window.api.getConfig()
    if (requestId !== modelRefreshRequestRef.current) return
    const status = await window.api.azureOpenai.getStatus()
    if (requestId !== modelRefreshRequestRef.current) return
    setAzureOpenaiEnabled(config.azureOpenaiEnabled)
    setAzureOpenaiApiKeyDraft(config.azureOpenaiApiKey ?? '')
    setAzureOpenaiEndpoint(config.azureOpenaiEndpoint ?? '')
    setAzureOpenaiApiVersion(config.azureOpenaiApiVersion || '2024-10-21')
    setAzureOpenaiDeployments(config.azureOpenaiDeployments)
    setSelectedAzureOpenaiModel(config.selectedModelByProvider['azure-openai'])
    setAzureOpenaiStatus(status)
    const effectiveStatus = await refreshEffectiveProvider(requestId)
    if (!effectiveStatus || requestId !== modelRefreshRequestRef.current) return
    await refreshModelsForProvider(effectiveStatus.effective, requestId)
  }

  const handleSetAzureEnabled = async (enabled: boolean): Promise<void> => {
    const requestId = beginProviderOperation()
    await window.api.azureOpenai.setEnabled(enabled)
    if (requestId !== modelRefreshRequestRef.current) return
    await refreshAzureConfig(requestId)
    await refreshEffectiveProvider(requestId)
  }

  const handleSetAzureApiKey = async (key: string | null): Promise<void> => {
    const requestId = beginProviderOperation()
    await window.api.azureOpenai.setApiKey(key)
    if (requestId !== modelRefreshRequestRef.current) return
    await refreshAzureConfig(requestId)
    await refreshEffectiveProvider(requestId)
  }

  const handleSetAzureEndpoint = async (endpoint: string | null): Promise<void> => {
    const requestId = beginProviderOperation()
    await window.api.azureOpenai.setEndpoint(endpoint)
    if (requestId !== modelRefreshRequestRef.current) return
    await refreshAzureConfig(requestId)
    await refreshEffectiveProvider(requestId)
  }

  const handleSetAzureApiVersion = async (version: string): Promise<void> => {
    const requestId = beginProviderOperation()
    await window.api.azureOpenai.setApiVersion(version)
    if (requestId !== modelRefreshRequestRef.current) return
    await refreshAzureConfig(requestId)
    await refreshEffectiveProvider(requestId)
  }

  const handleValidateAzure = async (): Promise<void> => {
    const requestId = beginProviderOperation()
    await window.api.azureOpenai.validateAndFetchModels()
    if (requestId !== modelRefreshRequestRef.current) return
    await refreshAzureConfig(requestId)
    await refreshEffectiveProvider(requestId)
  }

  const handleRefreshAzure = async (): Promise<void> => {
    const requestId = beginProviderOperation()
    await window.api.azureOpenai.refreshModels()
    if (requestId !== modelRefreshRequestRef.current) return
    await refreshAzureConfig(requestId)
    await refreshEffectiveProvider(requestId)
  }

  const handleToggleAzureDeployment = async (name: string, enabled: boolean): Promise<void> => {
    const requestId = beginProviderOperation()
    await window.api.azureOpenai.setDeploymentEnabled(name, enabled)
    if (requestId !== modelRefreshRequestRef.current) return
    await refreshAzureConfig(requestId)
    await refreshEffectiveProvider(requestId)
  }

  const handleAddAzureDeployment = async (name: string): Promise<void> => {
    const requestId = beginProviderOperation()
    await window.api.azureOpenai.addDeployment(name)
    if (requestId !== modelRefreshRequestRef.current) return
    await refreshAzureConfig(requestId)
  }

  const handleRemoveAzureDeployment = async (name: string): Promise<void> => {
    const requestId = beginProviderOperation()
    await window.api.azureOpenai.removeDeployment(name)
    if (requestId !== modelRefreshRequestRef.current) return
    await refreshAzureConfig(requestId)
    await refreshEffectiveProvider(requestId)
  }

  const handleValidateOpenai = async (): Promise<void> => {
    const requestId = beginProviderOperation()
    const config = await window.api.openai.validateAndFetchModels()
    await applyConfig(config, requestId)
  }

  const handleRefreshOpenAi = async (): Promise<void> => {
    const requestId = beginProviderOperation()
    const config = await window.api.openai.refreshModels()
    await applyConfig(config, requestId)
  }

  const handleToggleOpenAiModel = async (id: string, enabled: boolean): Promise<void> => {
    const requestId = beginProviderOperation()
    await window.api.setOpenaiModelEnabled(id, enabled)
    if (requestId !== modelRefreshRequestRef.current) return
    setOpenaiModelEnabled((prev) => ({ ...prev, [id]: enabled }))
    await refreshOpenAiStatus(requestId)
    if (requestId !== modelRefreshRequestRef.current) return
    if (llmProvider === 'openai') {
      await refreshModelsForProvider('openai', requestId)
    }
    await refreshAvailableImageModels()
  }

  const openAiChatReady =
    openaiStatus.validationOk && openaiStatus.enabledCount > 0
  const azureChatReady =
    azureOpenaiStatus.validationOk && azureOpenaiStatus.enabledDeploymentCount > 0
  const canSendBackend =
    effectiveProvider === 'openai'
      ? openAiChatReady || ollamaOk
      : effectiveProvider === 'azure-openai'
        ? azureChatReady || ollamaOk
        : ollamaOk
  const handleNavigate = (
    target: 'chat' | 'image' | 'models' | 'mcp' | 'skills' | 'schedules' | 'settings'
  ): void => {
    if (target === 'models') {
      setModelsVisited(true)
      void window.api.ollama.searchLibrary({ page: 1 }).catch(() => {})
    } else if (target === 'mcp') {
      setMcpVisited(true)
    } else if (target === 'skills') {
      setSkillsVisited(true)
    } else if (target === 'schedules') {
      setSchedulesVisited(true)
    } else if (target === 'settings') {
      setSettingsVisited(true)
    }
    setView(target)
  }

  return (
    <div className="relative flex h-full overflow-hidden bg-[#0f1419] text-[#e7ecf1]">
      {scheduleToast && (
        <div
          className="absolute left-1/2 top-3 z-50 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 rounded-lg border border-[#2d6cb5]/40 bg-[#1a3050] px-4 py-3 shadow-lg shadow-black/40"
          role="status"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#9ec5f0]">
                Schedule: {scheduleToast.scheduleName}
              </p>
              <p className="mt-1 text-sm text-[#c5d0dc]">{scheduleToast.snippet}</p>
            </div>
            <button
              type="button"
              onClick={() => setScheduleToast(null)}
              className="shrink-0 text-xs text-[#8b9aab] hover:text-[#e7ecf1]"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        queueState={queueState}
        view={view}
        onNewSession={() => void handleNewSession()}
        onSelectSession={(id) => void handleSelectSession(id)}
        onDeleteSession={(id) => void handleDeleteSession(id)}
        onNavigate={handleNavigate}
      />
      {modelsVisited ? (
        <div
          className={
            view === 'models' ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'
          }
        >
          <ModelsPage
            models={ollamaModels}
            ollamaOk={ollamaOk}
            llmProvider={llmProvider}
            selectedModel={selectedModel}
            openaiEnabled={openaiEnabled}
            openaiStatus={openaiStatus}
            openaiCatalog={openaiCatalog}
            openaiModelEnabled={openaiModelEnabled}
            selectedOpenAiModel={selectedOpenAiModel}
            azureOpenaiEnabled={azureOpenaiEnabled}
            azureOpenaiStatus={azureOpenaiStatus}
            azureOpenaiDeployments={azureOpenaiDeployments}
            selectedAzureOpenaiModel={selectedAzureOpenaiModel}
            active={view === 'models'}
            onRefreshModels={async () => {
              const requestId = beginProviderOperation()
              await refreshOllama(requestId)
              if (requestId !== modelRefreshRequestRef.current) return
              if (llmProvider === 'ollama') {
                const config = await window.api.getConfig()
                if (requestId !== modelRefreshRequestRef.current) return
                setSelectedModel(config.selectedModel)
              }
            }}
            onRefreshOpenAi={() => handleRefreshOpenAi()}
            onToggleOpenAiModel={(id, enabled) => handleToggleOpenAiModel(id, enabled)}
            onRefreshAzure={handleRefreshAzure}
            onAddAzureDeployment={handleAddAzureDeployment}
            onRemoveAzureDeployment={handleRemoveAzureDeployment}
            onToggleAzureDeployment={handleToggleAzureDeployment}
            onUseInChat={(m) => void handleUseOllamaModelInChat(m)}
          />
        </div>
      ) : null}
      {mcpVisited ? (
        <div
          className={view === 'mcp' ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'}
        >
          <McpCatalogPage
            servers={servers}
            tools={tools}
            onRefreshServers={() => refreshServers()}
          />
        </div>
      ) : null}
      {skillsVisited ? (
        <div
          className={
            view === 'skills' ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'
          }
        >
          <SkillsPage active={view === 'skills'} />
        </div>
      ) : null}
      {schedulesVisited ? (
        <div
          className={
            view === 'schedules' ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'
          }
        >
          <SchedulesPage active={view === 'schedules'} sessions={sessions} />
        </div>
      ) : null}
      {settingsVisited ? (
        <div
          className={
            view === 'settings' ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'
          }
        >
          <Settings
            llmProvider={llmProvider}
            openaiEnabled={openaiEnabled}
            openaiApiKeyDraft={openaiApiKeyDraft}
            openaiStatus={openaiStatus}
            ollamaOk={ollamaOk}
            ollamaError={ollamaError}
            baseUrl={baseUrl}
            showThinking={showThinking}
            maxToolIterations={maxToolIterations}
            imageBackend={imageBackend}
            availableImageModels={availableImageModels}
            telegramEnabled={telegramEnabled}
            telegramAllowedUserIds={telegramAllowedUserIds}
            telegramStatus={telegramStatus}
            telegramTokenDraft={telegramTokenDraft}
            azureOpenaiEnabled={azureOpenaiEnabled}
            azureOpenaiApiKeyDraft={azureOpenaiApiKeyDraft}
            azureOpenaiEndpoint={azureOpenaiEndpoint}
            azureOpenaiApiVersion={azureOpenaiApiVersion}
            azureOpenaiStatus={azureOpenaiStatus}
            onSetTelegramToken={(token) => void handleSetTelegramToken(token)}
            onSetTelegramEnabled={(enabled) => void handleSetTelegramEnabled(enabled)}
            onSetTelegramAllowedUserIds={(ids) =>
              void handleSetTelegramAllowedUserIds(ids)
            }
            onRefreshOllama={() => void refreshOllama()}
            onSetBaseUrl={(u) => void handleSetBaseUrl(u)}
            onSetShowThinking={(v) => void handleSetShowThinking(v)}
            onSetMaxToolIterations={(v) => void handleSetMaxToolIterations(v)}
            onSetLlmProvider={(p) => void handleSetLlmProvider(p)}
            onSetOpenaiEnabled={(v) => void handleSetOpenaiEnabled(v)}
            onSetOpenaiApiKey={(k) => void handleSetOpenaiApiKey(k)}
            onValidateOpenai={() => void handleValidateOpenai()}
            onSetAzureEnabled={handleSetAzureEnabled}
            onSetAzureApiKey={handleSetAzureApiKey}
            onSetAzureEndpoint={handleSetAzureEndpoint}
            onSetAzureApiVersion={handleSetAzureApiVersion}
            onValidateAzure={handleValidateAzure}
            onOpenModelsPage={() => handleNavigate('models')}
            onSetImageBackend={(selection) => void handleSetImageBackend(selection)}
          />
        </div>
      ) : null}
      {view === 'image' ? <ImageGeneration active={view === 'image'} /> : null}
      {view === 'chat' ? (
        <Chat
          key={activeSessionId ?? 'chat'}
          title={
            sessions.find((s) => s.id === activeSessionId)?.title ?? 'New chat'
          }
          messages={messages}
          busy={busy}
          activity={activity}
          showThinking={showThinking}
          canSend={
            Boolean(selectedModel) &&
            canSendBackend &&
            !activeSessionReadOnly &&
            activeSessionQueueStatus === 'idle'
          }
          readOnly={activeSessionReadOnly}
          llmProvider={llmProvider}
          effectiveProvider={effectiveProvider}
          providerFallbackReason={providerFallbackReason}
          ollamaOk={ollamaOk}
          imageGenSupported={imageGenSupported}
          models={models}
          selectedModel={selectedModel}
          reasoningEffort={reasoningEffort}
          onSetReasoningEffort={(v) => void handleSetReasoningEffort(v)}
          tools={tools}
          contextUsage={contextUsage}
          onSelectModel={(m) => void handleSelectModel(m)}
          onSend={(payload) => void handleSend(payload)}
          onAbort={() => void handleAbort()}
          onClear={handleClear}
          onOpenSettings={() => handleNavigate('settings')}
        />
      ) : null}
    </div>
  )
}
