import type { IpcMain } from 'electron'
import type { ChatSendPayload, ChatSession, McpServerConfig } from '../shared/types'
import { abortChat, runAgentTurn } from './agent'
import {
  createSession,
  deleteSession,
  ensureActiveSession,
  getConfig,
  getSelectedModel,
  getSessionsState,
  listServers,
  removeServer,
  setActiveSession,
  setOllamaBaseUrl,
  setSelectedModel,
  setServerEnabled,
  updateSession,
  upsertServer
} from './config-store'
import { mcpManager } from './mcp-manager'
import { getOllamaStatus, listModels } from './ollama'

export async function restoreMcpConnections(): Promise<void> {
  const servers = listServers().filter((s) => s.enabled)
  for (const server of servers) {
    try {
      await mcpManager.connect(server)
      console.log(`[mcp] restored connection: ${server.name}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[mcp] failed to restore ${server.name}: ${message}`)
    }
  }
}

export function registerIpc(ipcMain: IpcMain): void {
  ipcMain.handle('config:get', () => getConfig())

  ipcMain.handle('ollama:getStatus', () => getOllamaStatus())
  ipcMain.handle('ollama:listModels', () => listModels())
  ipcMain.handle('ollama:setBaseUrl', (_e, url: string) => setOllamaBaseUrl(url))
  ipcMain.handle('ollama:getSelectedModel', () => getSelectedModel())
  ipcMain.handle('ollama:setSelectedModel', (_e, model: string | null) => {
    setSelectedModel(model)
  })

  ipcMain.handle('mcp:listServers', () => {
    const servers = listServers()
    const connected = new Set(mcpManager.getConnectedIds())
    return servers.map((s) => ({
      ...s,
      connected: connected.has(s.id)
    }))
  })

  ipcMain.handle('mcp:upsertServer', async (_e, server: McpServerConfig) => {
    const servers = upsertServer(server)
    if (mcpManager.isConnected(server.id)) {
      if (server.enabled) {
        await mcpManager.connect(server)
      } else {
        await mcpManager.disconnect(server.id)
      }
    } else if (server.enabled) {
      try {
        await mcpManager.connect(server)
      } catch {
        // leave enabled so next launch / manual connect can retry
      }
    }
    return servers
  })

  ipcMain.handle('mcp:removeServer', async (_e, id: string) => {
    if (mcpManager.isConnected(id)) {
      await mcpManager.disconnect(id)
    }
    return removeServer(id)
  })

  ipcMain.handle('mcp:connect', async (_e, id: string) => {
    const server = listServers().find((s) => s.id === id)
    if (!server) throw new Error('Server not found')
    const tools = await mcpManager.connect(server)
    setServerEnabled(id, true)
    return tools
  })

  ipcMain.handle('mcp:disconnect', async (_e, id: string) => {
    await mcpManager.disconnect(id)
    setServerEnabled(id, false)
  })

  ipcMain.handle('mcp:listTools', () => mcpManager.listAllTools())

  ipcMain.handle('sessions:list', () => ensureActiveSession())
  ipcMain.handle('sessions:create', () => {
    createSession()
    return getSessionsState()
  })
  ipcMain.handle('sessions:setActive', (_e, id: string) => setActiveSession(id))
  ipcMain.handle(
    'sessions:update',
    (
      _e,
      id: string,
      patch: Partial<Pick<ChatSession, 'title' | 'uiMessages' | 'history'>>
    ) => {
      updateSession(id, patch)
      return getSessionsState()
    }
  )
  ipcMain.handle('sessions:delete', (_e, id: string) => deleteSession(id))

  ipcMain.handle('chat:send', async (_e, payload: ChatSendPayload) => {
    void runAgentTurn(payload)
  })

  ipcMain.handle('chat:abort', () => {
    abortChat()
  })
}
