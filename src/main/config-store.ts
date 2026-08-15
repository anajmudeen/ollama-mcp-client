import { randomUUID } from 'crypto'
import Store from 'electron-store'
import type {
  AppConfig,
  ChatMessage,
  ChatSession,
  McpServerConfig,
  SessionsState
} from '../shared/types'

const DEFAULT_CONFIG: AppConfig = {
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  selectedModel: null,
  servers: []
}

interface StoreSchema extends AppConfig, SessionsState {}

const store = new Store<StoreSchema>({
  name: 'config',
  defaults: {
    ...DEFAULT_CONFIG,
    sessions: [],
    activeSessionId: null
  }
})

export function getConfig(): AppConfig {
  return {
    ollamaBaseUrl: store.get('ollamaBaseUrl', DEFAULT_CONFIG.ollamaBaseUrl),
    selectedModel: store.get('selectedModel', DEFAULT_CONFIG.selectedModel),
    servers: store.get('servers', DEFAULT_CONFIG.servers)
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

export function getSelectedModel(): string | null {
  return store.get('selectedModel', null)
}

export function setSelectedModel(model: string | null): void {
  store.set('selectedModel', model)
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

function sortSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

export function listSessions(): ChatSession[] {
  return sortSessions(store.get('sessions', []))
}

export function getActiveSessionId(): string | null {
  return store.get('activeSessionId', null)
}

export function getSessionsState(): SessionsState {
  const sessions = listSessions()
  let activeSessionId = getActiveSessionId()
  if (activeSessionId && !sessions.some((s) => s.id === activeSessionId)) {
    activeSessionId = sessions[0]?.id ?? null
    store.set('activeSessionId', activeSessionId)
  }
  return { sessions, activeSessionId }
}

export function createSession(): ChatSession {
  const now = new Date().toISOString()
  const session: ChatSession = {
    id: randomUUID(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    uiMessages: [],
    history: []
  }
  const sessions = [session, ...listSessions()]
  store.set('sessions', sessions)
  store.set('activeSessionId', session.id)
  return session
}

export function setActiveSession(id: string): SessionsState {
  const sessions = listSessions()
  if (!sessions.some((s) => s.id === id)) {
    throw new Error('Session not found')
  }
  store.set('activeSessionId', id)
  return getSessionsState()
}

export function updateSession(
  id: string,
  patch: Partial<Pick<ChatSession, 'title' | 'uiMessages' | 'history'>>
): ChatSession {
  const sessions = listSessions()
  const idx = sessions.findIndex((s) => s.id === id)
  if (idx < 0) throw new Error('Session not found')

  const updated: ChatSession = {
    ...sessions[idx],
    ...patch,
    history: patch.history
      ? stripHeavyHistory(patch.history)
      : sessions[idx].history,
    uiMessages: patch.uiMessages ?? sessions[idx].uiMessages,
    updatedAt: new Date().toISOString()
  }
  sessions[idx] = updated
  store.set('sessions', sessions)
  return updated
}

export function deleteSession(id: string): SessionsState {
  let sessions = listSessions().filter((s) => s.id !== id)
  let activeSessionId = getActiveSessionId()

  if (activeSessionId === id) {
    activeSessionId = sessions[0]?.id ?? null
  }

  if (sessions.length === 0) {
    const now = new Date().toISOString()
    const session: ChatSession = {
      id: randomUUID(),
      title: 'New chat',
      createdAt: now,
      updatedAt: now,
      uiMessages: [],
      history: []
    }
    sessions = [session]
    activeSessionId = session.id
  }

  store.set('sessions', sessions)
  store.set('activeSessionId', activeSessionId)
  return getSessionsState()
}

export function ensureActiveSession(): SessionsState {
  const state = getSessionsState()
  if (state.sessions.length === 0 || !state.activeSessionId) {
    createSession()
    return getSessionsState()
  }
  return state
}
