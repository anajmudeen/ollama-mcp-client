export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  enabled: boolean
}

export interface AppConfig {
  ollamaBaseUrl: string
  selectedModel: string | null
  servers: McpServerConfig[]
}

export interface OllamaModel {
  name: string
  size: number
  modifiedAt: string
  /** Display tags derived from Ollama model metadata (capabilities, family, size, …). */
  tags: string[]
  capabilities?: string[]
  family?: string
  parameterSize?: string
  quantization?: string
}

export interface OllamaStatus {
  ok: boolean
  baseUrl: string
  error?: string
}

export interface McpToolInfo {
  serverId: string
  serverName: string
  name: string
  prefixedName: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export type ChatRole = 'user' | 'assistant' | 'tool' | 'system'

export interface ChatToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatMessage {
  role: ChatRole
  content: string
  /** Raw base64 image payloads for Ollama vision models (no data-URL prefix). */
  images?: string[]
  tool_calls?: ChatToolCall[]
  tool_name?: string
}

export type ActivityPhase =
  | 'idle'
  | 'thinking'
  | 'generating'
  | 'tool'
  | 'synthesizing'

export type ChatEvent =
  | { type: 'user'; content: string; turnId?: string }
  | {
      type: 'status'
      phase: Exclude<ActivityPhase, 'idle'>
      detail?: string
      turnId?: string
    }
  | { type: 'thinking'; content: string; turnId?: string }
  | { type: 'chunk'; content: string; turnId?: string }
  | { type: 'assistant_done'; content: string; turnId?: string }
  | {
      type: 'tool_start'
      id: string
      name: string
      arguments: Record<string, unknown>
      turnId?: string
    }
  | {
      type: 'tool_result'
      id: string
      name: string
      ok: boolean
      result: string
      turnId?: string
    }
  | { type: 'done'; turnId?: string }
  | { type: 'error'; message: string; turnId?: string }

export interface ChatSendPayload {
  model: string
  messages: ChatMessage[]
  /** Client-generated id so the UI can ignore stale events from aborted turns. */
  turnId: string
}

export type UiMessage =
  | {
      kind: 'user'
      id: string
      content: string
      attachmentLabels?: string[]
    }
  | { kind: 'assistant'; id: string; content: string; streaming?: boolean }
  | {
      kind: 'tool'
      id: string
      name: string
      arguments: Record<string, unknown>
      status: 'running' | 'done' | 'error'
      result?: string
    }
  | { kind: 'error'; id: string; content: string }

export interface ChatSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  uiMessages: UiMessage[]
  history: ChatMessage[]
}

export interface SessionsState {
  sessions: ChatSession[]
  activeSessionId: string | null
}
