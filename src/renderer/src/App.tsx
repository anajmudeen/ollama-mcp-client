import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ActivityPhase,
  ChatEvent,
  ChatMessage,
  ChatSession,
  McpToolInfo,
  OllamaModel,
  UiMessage
} from '../../shared/types'
import type { ServerWithStatus } from '../../preload/index'
import type { ActivityState } from './components/ActivityIndicator'
import { Chat } from './components/Chat'
import { McpCatalogPage } from './components/McpCatalogPage'
import { ModelsPage } from './components/ModelsPage'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { SkillsPage } from './components/SkillsPage'

function uid(): string {
  return crypto.randomUUID()
}

function nowIso(): string {
  return new Date().toISOString()
}

const IDLE_ACTIVITY: ActivityState = { phase: 'idle' }

function titleFromPrompt(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'New chat'
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned
}

export default function App(): React.JSX.Element {
  const [servers, setServers] = useState<ServerWithStatus[]>([])
  const [tools, setTools] = useState<McpToolInfo[]>([])
  const [models, setModels] = useState<OllamaModel[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [ollamaOk, setOllamaOk] = useState(false)
  const [ollamaError, setOllamaError] = useState<string | undefined>()
  const [imageGenSupported, setImageGenSupported] = useState(true)
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:11434')
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState<ActivityState>(IDLE_ACTIVITY)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showThinking, setShowThinking] = useState(false)
  const [view, setView] = useState<'chat' | 'models' | 'mcp' | 'skills'>('chat')
  const [modelsVisited, setModelsVisited] = useState(false)
  const [mcpVisited, setMcpVisited] = useState(false)
  const [skillsVisited, setSkillsVisited] = useState(false)
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
  const showThinkingRef = useRef(false)
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

  const syncMessages = useCallback((next: UiMessage[]) => {
    messagesRef.current = next
    setMessages(next)
  }, [])

  const applySessionsState = useCallback(
    (state: { sessions: ChatSession[]; activeSessionId: string | null }) => {
      setSessions(state.sessions)
      setActiveSessionId(state.activeSessionId)
      activeSessionIdRef.current = state.activeSessionId
      const active = state.sessions.find((s) => s.id === state.activeSessionId)
      if (active) {
        messagesRef.current = active.uiMessages
        setMessages(active.uiMessages)
        historyRef.current = active.history
        sessionTitleRef.current = active.title
      } else {
        messagesRef.current = []
        setMessages([])
        historyRef.current = []
        sessionTitleRef.current = 'New chat'
      }
    },
    []
  )

  const writeSession = useCallback(
    async (
      id: string,
      uiMessages: UiMessage[],
      history: ChatMessage[],
      title?: string
    ): Promise<void> => {
      try {
        const patch: Partial<
          Pick<ChatSession, 'title' | 'uiMessages' | 'history'>
        > = {
          uiMessages,
          history
        }
        if (title !== undefined) patch.title = title
        const state = await window.api.sessions.update(id, patch)
        // Refresh list only — never reload the open chat from this response
        // (that races with an in-progress switch).
        setSessions(state.sessions)
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

  const refreshOllama = useCallback(async () => {
    const status = await window.api.ollama.getStatus()
    setOllamaOk(status.ok)
    setOllamaError(status.error)
    setBaseUrl(status.baseUrl)
    setImageGenSupported(status.imageGenSupported !== false)
    if (status.ok) {
      try {
        const list = await window.api.ollama.listModels()
        setModels(list)
        const names = list.map((m) => m.name)
        setSelectedModel((current) => {
          if (current && names.includes(current)) return current
          const next = names[0] ?? null
          if (next) {
            void window.api.ollama.setSelectedModel(next)
          }
          return next
        })
      } catch (err) {
        setOllamaOk(false)
        setOllamaError(err instanceof Error ? err.message : String(err))
      }
    } else {
      setModels([])
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const config = await window.api.getConfig()
      setBaseUrl(config.ollamaBaseUrl)
      setSelectedModel(config.selectedModel)
      setShowThinking(Boolean(config.showThinking))
      showThinkingRef.current = Boolean(config.showThinking)
      const sessionState = await window.api.sessions.list()
      applySessionsState(sessionState)
      await refreshServers()
      await refreshOllama()
    })()
  }, [applySessionsState, refreshOllama, refreshServers])

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
            model: turnModelRef.current ?? undefined
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
        let next = prev.map((m) =>
          m.kind === 'thinking' && m.streaming ? { ...m, streaming: false } : m
        )
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
            model: turnModelRef.current ?? undefined
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

      const sessionId = activeSessionIdRef.current
      if (!sessionId) return

      const turnOk =
        Boolean(event.turnId) &&
        Boolean(activeTurnIdRef.current) &&
        event.turnId === activeTurnIdRef.current

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
          const next = [...prev].map((m) =>
            m.kind === 'thinking' && m.streaming ? { ...m, streaming: false } : m
          )
          const last = next[next.length - 1]
          if (last?.kind === 'assistant' && last.streaming) {
            next[next.length - 1] = {
              ...last,
              content: event.content || last.content,
              streaming: false,
              createdAt: finishedAt,
              responseMs,
              contextUsed: event.contextUsed ?? last.contextUsed,
              contextLimit: event.contextLimit ?? last.contextLimit,
              tokensPerSec: event.tokensPerSec ?? last.tokensPerSec
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
              tokensPerSec: event.tokensPerSec
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
          { role: 'assistant', content: '[generated image]' }
        ]
        const historySnapshot = historyRef.current
        const responseMs =
          turnStartedAtRef.current != null
            ? Date.now() - turnStartedAtRef.current
            : undefined
        const finishedAt = nowIso()
        setMessages((prev) => {
          if (sessionId !== activeSessionIdRef.current) return prev
          const next = [...prev].map((m) =>
            m.kind === 'thinking' && m.streaming ? { ...m, streaming: false } : m
          )
          const last = next[next.length - 1]
          if (last?.kind === 'assistant' && last.streaming) {
            next[next.length - 1] = {
              ...last,
              content: last.content || '',
              images: dataUrls,
              streaming: false,
              createdAt: finishedAt,
              responseMs
            }
          } else {
            next.push({
              kind: 'assistant',
              id: uid(),
              content: '',
              images: dataUrls,
              createdAt: finishedAt,
              streaming: false,
              responseMs,
              model: turnModelRef.current ?? undefined
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
          const next = prev.map((m) =>
            m.kind === 'thinking' && m.streaming ? { ...m, streaming: false } : m
          )
          const last = next[next.length - 1]
          const responseMs =
            turnStartedAtRef.current != null
              ? Date.now() - turnStartedAtRef.current
              : undefined
          const withClosed =
            last?.kind === 'assistant' && last.streaming
              ? [
                  ...next.slice(0, -1),
                  {
                    ...last,
                    streaming: false,
                    createdAt: nowIso(),
                    responseMs: last.responseMs ?? responseMs
                  }
                ]
              : [...next]
          withClosed.push({
            kind: 'tool',
            id: event.id,
            name: event.name,
            arguments: event.arguments,
            status: 'running',
            createdAt: nowIso(),
            model: turnModelRef.current ?? undefined
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
              ? {
                  ...m,
                  status: event.ok ? ('done' as const) : ('error' as const),
                  result: event.result
                }
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
          const next = prev.map((m) =>
            m.kind === 'assistant' && m.streaming
              ? {
                  ...m,
                  streaming: false,
                  createdAt: finishedAt,
                  responseMs: m.responseMs ?? responseMs
                }
              : m
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

  const handleSend = async (payload: {
    content: string
    images?: string[]
    attachmentLabels?: string[]
    invokedSkill?: string
  }): Promise<void> => {
    if (!selectedModel || busy) return
    if (!payload.content.trim() && !payload.images?.length) return
    const sessionId = activeSessionIdRef.current
    if (!sessionId) return

    const turnId = uid()
    activeTurnIdRef.current = turnId
    turnStartedAtRef.current = Date.now()
    turnModelRef.current = selectedModel

    const userMsg: ChatMessage = {
      role: 'user',
      content: payload.content,
      images: payload.images
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
        model: selectedModel
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

    setBusy(true)
    setActivity({
      phase: 'thinking',
      detail: 'Waiting for the model…',
      thinking: '',
      startedAt: Date.now()
    })
    await window.api.chat.send({
      model: selectedModel,
      messages: nextHistory,
      turnId,
      contextUsed: contextUsage?.used,
      invokedSkill: payload.invokedSkill
    })
  }

  const handleAbort = async (): Promise<void> => {
    bumpChatEpoch()
    activeTurnIdRef.current = null
    await window.api.chat.abort()
    setBusy(false)
    setActivity(IDLE_ACTIVITY)
  }

  const handleClear = (): void => {
    const sessionId = activeSessionIdRef.current
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

  const leaveCurrentSession = useCallback(async (): Promise<void> => {
    bumpChatEpoch()
    activeTurnIdRef.current = null
    await window.api.chat.abort()
    setBusy(false)
    setActivity(IDLE_ACTIVITY)
    setContextUsage(null)
    await flushActiveSession()
  }, [bumpChatEpoch, flushActiveSession])

  const handleNewSession = async (): Promise<void> => {
    setView('chat')
    await leaveCurrentSession()
    const state = await window.api.sessions.create()
    applySessionsState(state)
  }

  const handleSelectSession = async (id: string): Promise<void> => {
    setView('chat')
    if (id === activeSessionIdRef.current) return
    await leaveCurrentSession()
    const state = await window.api.sessions.setActive(id)
    applySessionsState(state)
  }

  const handleDeleteSession = async (id: string): Promise<void> => {
    if (pendingAiTitleRef.current?.sessionId === id) {
      cancelAiTitle()
    }
    if (id === activeSessionIdRef.current) {
      await leaveCurrentSession()
    }
    const state = await window.api.sessions.delete(id)
    applySessionsState(state)
  }

  const handleSelectModel = async (model: string): Promise<void> => {
    setSelectedModel(model)
    setContextUsage(null)
    await window.api.ollama.setSelectedModel(model)
  }

  const handleUseModelInChat = async (model: string): Promise<void> => {
    await handleSelectModel(model)
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

  return (
    <div className="flex h-full overflow-hidden bg-[#0f1419] text-[#e7ecf1]">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        view={view}
        onNewSession={() => void handleNewSession()}
        onSelectSession={(id) => void handleSelectSession(id)}
        onDeleteSession={(id) => void handleDeleteSession(id)}
        onOpenModels={() => {
          setModelsVisited(true)
          setView('models')
          // Warm the default library list cache while Models opens.
          void window.api.ollama.searchLibrary({ page: 1 }).catch(() => {})
        }}
        onOpenMcp={() => {
          setMcpVisited(true)
          setView('mcp')
        }}
        onOpenSkills={() => {
          setSkillsVisited(true)
          setView('skills')
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {modelsVisited ? (
        <div
          className={
            view === 'models' ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'
          }
        >
          <ModelsPage
            models={models}
            ollamaOk={ollamaOk}
            selectedModel={selectedModel}
            active={view === 'models'}
            onRefreshModels={async () => {
              await refreshOllama()
              const selected = await window.api.ollama.getSelectedModel()
              setSelectedModel(selected)
            }}
            onUseInChat={(m) => void handleUseModelInChat(m)}
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
          canSend={Boolean(selectedModel) && ollamaOk}
          ollamaOk={ollamaOk}
          imageGenSupported={imageGenSupported}
          models={models}
          selectedModel={selectedModel}
          tools={tools}
          contextUsage={contextUsage}
          onSelectModel={(m) => void handleSelectModel(m)}
          onSend={(payload) => void handleSend(payload)}
          onAbort={() => void handleAbort()}
          onClear={handleClear}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : null}
      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        ollamaOk={ollamaOk}
        ollamaError={ollamaError}
        baseUrl={baseUrl}
        showThinking={showThinking}
        onRefreshOllama={() => void refreshOllama()}
        onSetBaseUrl={(u) => void handleSetBaseUrl(u)}
        onSetShowThinking={(v) => void handleSetShowThinking(v)}
      />
    </div>
  )
}
