import type { AzureOpenaiModelEntry } from '../shared/types'
import type { OllamaChatChunk, OllamaChatMessage, OllamaTool } from './ollama'
import {
  formatOpenAiError,
  ollamaMessagesToOpenAi,
  ollamaToolsToOpenAi,
  parseOpenAiUsageFromJson,
  type OpenAiStreamResult,
  type OpenAiUsageDetails
} from './openai-client'
import { supportsAzureDeploymentReasoning } from '../shared/azure-deployment'
import { getAzureOpenaiDeployments, getReasoningEffort } from './config-store'
import {
  resolveReasoningEffortForRequest,
  type ReasoningEffort
} from '../shared/reasoning-effort'

export interface AzureOpenaiRequestOptions {
  endpoint: string
  apiVersion: string
  apiKey: string
}

export function normalizeAzureEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '')
}

export function buildAzureModelsUrl(endpoint: string, apiVersion: string): string {
  return `${normalizeAzureEndpoint(endpoint)}/openai/models?api-version=${encodeURIComponent(apiVersion)}`
}

export function buildAzureChatUrl(
  endpoint: string,
  deployment: string,
  apiVersion: string
): string {
  return `${normalizeAzureEndpoint(endpoint)}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`
}

function azureHeaders(apiKey: string): Record<string, string> {
  return { 'api-key': apiKey, 'Content-Type': 'application/json' }
}

function safeAzureError(text: string, status: number, apiKey: string): string {
  return formatOpenAiError(text, status).replaceAll(apiKey, '[redacted]')
}

export async function fetchAzureModels(
  options: AzureOpenaiRequestOptions
): Promise<AzureOpenaiModelEntry[]> {
  const res = await fetch(buildAzureModelsUrl(options.endpoint, options.apiVersion), {
    headers: azureHeaders(options.apiKey)
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(safeAzureError(text, res.status, options.apiKey))
  }
  const data = (await res.json()) as {
    data?: Array<{
      id?: string
      created?: number
      capabilities?: Record<string, boolean>
    }>
  }
  return (data.data ?? [])
    .filter((entry): entry is typeof entry & { id: string } => typeof entry.id === 'string')
    .map((entry) => ({
      id: entry.id,
      capabilities: Object.entries(entry.capabilities ?? {})
        .filter(([, enabled]) => enabled)
        .map(([name]) => name),
      created: entry.created
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export async function validateAzureOpenai(
  options: AzureOpenaiRequestOptions
): Promise<{ ok: boolean; error?: string }> {
  try {
    await fetchAzureModels(options)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

interface AzureChatOptions extends AzureOpenaiRequestOptions {
  deployment: string
  messages: OllamaChatMessage[]
  tools?: OllamaTool[]
  signal?: AbortSignal
  onChunk?: (chunk: OllamaChatChunk) => void
}

function buildChatBody(
  options: AzureChatOptions,
  stream: boolean
): { body: Record<string, unknown>; reasoningEffortSent?: ReasoningEffort } {
  const body: Record<string, unknown> = {
    messages: ollamaMessagesToOpenAi(options.messages),
    stream
  }
  if (stream) body.stream_options = { include_usage: true }
  if (options.tools?.length) {
    body.tools = ollamaToolsToOpenAi(options.tools)
  }
  const deploymentEntry = getAzureOpenaiDeployments().find(
    (entry) => entry.name === options.deployment
  )
  let reasoningEffortSent: ReasoningEffort | undefined
  if (deploymentEntry && supportsAzureDeploymentReasoning(deploymentEntry)) {
    const effort = resolveReasoningEffortForRequest({
      model: deploymentEntry.model,
      hasTools: Boolean(options.tools?.length),
      preference: getReasoningEffort()
    })
    if (effort !== undefined) {
      body.reasoning_effort = effort
      reasoningEffortSent = effort
    }
  }
  return { body, reasoningEffortSent }
}

export async function azureOpenAiChatOnce(options: AzureChatOptions): Promise<string> {
  const res = await fetch(
    buildAzureChatUrl(options.endpoint, options.deployment, options.apiVersion),
    {
      method: 'POST',
      headers: azureHeaders(options.apiKey),
      body: JSON.stringify(buildChatBody(options, false).body),
      signal: options.signal
    }
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(safeAzureError(text, res.status, options.apiKey))
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content ?? ''
}

export async function azureOpenAiChatStream(
  options: AzureChatOptions
): Promise<OpenAiStreamResult> {
  const { body, reasoningEffortSent } = buildChatBody(options, true)
  const res = await fetch(
    buildAzureChatUrl(options.endpoint, options.deployment, options.apiVersion),
    {
      method: 'POST',
      headers: azureHeaders(options.apiKey),
      body: JSON.stringify(body),
      signal: options.signal
    }
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(safeAzureError(text, res.status, options.apiKey))
  }
  if (!res.body) throw new Error('Empty response body')

  let content = ''
  const toolCallsByIndex = new Map<number, { name: string; arguments: string; id: string }>()
  let promptEvalCount: number | undefined
  let evalCount: number | undefined
  let usage: OpenAiUsageDetails | undefined
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const processLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') return
    try {
      const chunk = JSON.parse(payload) as {
        choices?: Array<{
          delta?: {
            content?: string
            reasoning?: string
            reasoning_content?: string
            tool_calls?: Array<{
              index?: number
              id?: string
              function?: { name?: string; arguments?: string }
            }>
          }
        }>
        usage?: unknown
      }
      const delta = chunk.choices?.[0]?.delta
      const thinking = delta?.reasoning_content ?? delta?.reasoning
      if (delta?.content) {
        content += delta.content
        options.onChunk?.({ message: { content: delta.content } })
      }
      if (thinking) options.onChunk?.({ message: { thinking } })
      if (delta?.tool_calls) {
        options.onChunk?.({
          message: {
            tool_calls: delta.tool_calls.map((tc) => ({
              id: tc.id,
              function: {
                name: tc.function?.name ?? '',
                arguments: tc.function?.arguments ?? ''
              }
            }))
          }
        })
        for (const tc of delta.tool_calls) {
          const index = tc.index ?? 0
          const current = toolCallsByIndex.get(index) ?? {
            id: tc.id ?? `call_${index}`,
            name: '',
            arguments: ''
          }
          if (tc.id) current.id = tc.id
          if (tc.function?.name) current.name = tc.function.name
          if (tc.function?.arguments) current.arguments += tc.function.arguments
          toolCallsByIndex.set(index, current)
        }
      }
      if (chunk.usage) {
        const parsed = parseOpenAiUsageFromJson(chunk.usage)
        if (parsed) {
          usage = parsed
          promptEvalCount = parsed.promptTokens
          evalCount = parsed.completionTokens
        }
      }
    } catch {
      // Ignore malformed SSE records.
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) processLine(line)
  }
  buffer += decoder.decode()
  if (buffer) processLine(buffer)

  const toolCalls = [...toolCallsByIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => ({
      name: call.name,
      arguments: (() => {
        try {
          return JSON.parse(call.arguments) as Record<string, unknown>
        } catch {
          return call.arguments ? { value: call.arguments } : {}
        }
      })()
    }))
  return {
    content,
    toolCalls,
    promptEvalCount,
    evalCount,
    usage,
    reasoningEffortSent
  }
}
