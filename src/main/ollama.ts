import type {
  ChatMessage,
  OllamaModel,
  OllamaModelDetails,
  OllamaStatus,
  PullProgressEvent
} from '../shared/types'
import { getOllamaBaseUrl } from './config-store'

export interface OllamaTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export interface OllamaToolCall {
  function: {
    name: string
    arguments: Record<string, unknown> | string
  }
}

export interface OllamaChatMessage {
  role: string
  content: string
  images?: string[]
  tool_calls?: OllamaToolCall[]
  tool_name?: string
}

export interface OllamaChatChunk {
  message?: {
    role?: string
    content?: string
    thinking?: string
    tool_calls?: OllamaToolCall[]
  }
  done?: boolean
  error?: string
}

function normalizeArgs(
  args: Record<string, unknown> | string | undefined
): Record<string, unknown> {
  if (!args) return {}
  if (typeof args === 'string') {
    try {
      return JSON.parse(args) as Record<string, unknown>
    } catch {
      return { value: args }
    }
  }
  return args
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const baseUrl = getOllamaBaseUrl()
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) {
      return { ok: false, baseUrl, error: `HTTP ${res.status}` }
    }
    return { ok: true, baseUrl }
  } catch (err) {
    return {
      ok: false,
      baseUrl,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export async function listModels(): Promise<OllamaModel[]> {
  const baseUrl = getOllamaBaseUrl()
  const res = await fetch(`${baseUrl}/api/tags`)
  if (!res.ok) {
    throw new Error(`Failed to list models: HTTP ${res.status}`)
  }
  const data = (await res.json()) as {
    models?: Array<{
      name: string
      size: number
      modified_at: string
      details?: {
        family?: string
        families?: string[]
        parameter_size?: string
        quantization_level?: string
      }
    }>
  }
  const models = data.models ?? []
  const enriched = await Promise.all(
    models.map(async (m) => {
      const info = await getModelInfo(m.name).catch(() => null)
      const family = info?.details?.family ?? m.details?.family
      const families = info?.details?.families ?? m.details?.families ?? []
      const parameterSize =
        info?.details?.parameter_size ?? m.details?.parameter_size
      const quantization =
        info?.details?.quantization_level ?? m.details?.quantization_level

      const capabilities = [...(info?.capabilities ?? [])]
      if (
        !capabilities.includes('vision') &&
        detectVisionSupport(m.name, {
          capabilities,
          details: { family, families },
          model_info: info?.model_info
        }) === 'yes'
      ) {
        capabilities.push('vision')
      }

      const tags = buildModelTags({
        name: m.name,
        capabilities,
        family,
        families,
        parameterSize,
        quantization
      })

      return {
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at,
        tags,
        capabilities,
        family,
        parameterSize,
        quantization
      }
    })
  )
  return enriched
}

export interface OllamaModelInfo {
  capabilities?: string[]
  details?: {
    family?: string
    families?: string[]
    parameter_size?: string
    quantization_level?: string
  }
  model_info?: Record<string, unknown>
}

function buildModelTags(input: {
  name: string
  capabilities: string[]
  family?: string
  families?: string[]
  parameterSize?: string
  quantization?: string
}): string[] {
  const tags: string[] = []
  const seen = new Set<string>()
  const add = (tag: string | undefined): void => {
    const t = tag?.trim()
    if (!t) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    tags.push(t)
  }

  // Variant tag from name (e.g. 90b, latest, q4_K_M)
  const variant = input.name.includes(':') ? input.name.split(':').slice(1).join(':') : null
  if (variant && variant !== 'latest') add(variant)

  for (const cap of input.capabilities) add(cap)
  add(input.family)
  for (const f of input.families ?? []) {
    if (f !== input.family) add(f)
  }
  add(input.parameterSize)
  add(input.quantization)

  return tags
}

/** Turn raw Ollama / llama.cpp errors into actionable messages. */
export function formatOllamaError(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes("unknown model architecture: 'mllama'") || lower.includes('unknown model architecture: "mllama"')) {
    return (
      "This vision model uses the 'mllama' architecture, which your Ollama build does not support. " +
      'Update Ollama to the latest version (https://ollama.com/download), or use another vision model such as llava / moondream / gemma3.'
    )
  }
  if (lower.includes('unknown model architecture')) {
    const match = raw.match(/unknown model architecture:\s*'([^']+)'/i)
    const arch = match?.[1] ?? 'unknown'
    return (
      `Ollama cannot load architecture '${arch}'. Update Ollama, or pick a model your installed version supports.`
    )
  }
  return raw
}

export async function getModelInfo(model: string): Promise<OllamaModelInfo> {
  const baseUrl = getOllamaBaseUrl()
  const res = await fetch(`${baseUrl}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model })
  })
  if (!res.ok) return {}
  return (await res.json()) as OllamaModelInfo
}

export async function getModelCapabilities(model: string): Promise<string[]> {
  const info = await getModelInfo(model)
  return info.capabilities ?? []
}

/** Name patterns commonly used by multimodal / vision Ollama models. */
const VISION_NAME_RE =
  /vision|llava|bakllava|moondream|minicpm-v|qwen2(\.5)?-?vl|qwen2\.5vl|gemma3|pixtral|mistral-small.*vision|llama3\.2-vision/i

const VISION_FAMILY_RE = /mllama|clip|vision/i

export type VisionSupport = 'yes' | 'no' | 'unknown'

export function detectVisionSupport(
  model: string,
  info?: OllamaModelInfo | null
): VisionSupport {
  const caps = info?.capabilities
  if (caps?.includes('vision')) return 'yes'

  if (VISION_NAME_RE.test(model)) return 'yes'

  const families = [
    info?.details?.family,
    ...(info?.details?.families ?? [])
  ].filter(Boolean) as string[]
  if (families.some((f) => VISION_FAMILY_RE.test(f))) return 'yes'

  const modelInfo = info?.model_info ?? {}
  for (const key of Object.keys(modelInfo)) {
    if (/vision|projector|clip/i.test(key)) return 'yes'
  }

  // Capabilities reported, but no vision signal anywhere → likely text-only
  if (caps && caps.length > 0 && !caps.includes('vision')) return 'no'

  return 'unknown'
}

export function modelSupportsVision(
  model: string,
  capabilities?: string[],
  info?: OllamaModelInfo | null
): boolean {
  const resolved =
    info ??
    (capabilities
      ? { capabilities }
      : null)
  const support = detectVisionSupport(model, resolved)
  // Allow when yes or unknown — only block clear text-only models
  return support !== 'no'
}

export async function chatStream(options: {
  model: string
  messages: OllamaChatMessage[]
  tools?: OllamaTool[]
  signal?: AbortSignal
  onChunk: (chunk: OllamaChatChunk) => void
}): Promise<{
  content: string
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>
}> {
  const baseUrl = getOllamaBaseUrl()
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: true
  }
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools
  }

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const raw = `Ollama chat failed: HTTP ${res.status}${text ? ` — ${text}` : ''}`
    throw new Error(formatOllamaError(raw))
  }

  if (!res.body) {
    throw new Error('Ollama chat returned no body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  // Ollama re-sends the full tool_calls array on later chunks — replace, don't append
  let toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = []

  const ingestToolCalls = (calls: OllamaToolCall[] | undefined): void => {
    if (!calls?.length) return
    toolCalls = calls.map((tc) => ({
      name: tc.function.name,
      arguments: normalizeArgs(tc.function.arguments)
    }))
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let chunk: OllamaChatChunk
      try {
        chunk = JSON.parse(trimmed) as OllamaChatChunk
      } catch {
        continue
      }
      if (chunk.error) {
        throw new Error(formatOllamaError(chunk.error))
      }
      options.onChunk(chunk)
      const msg = chunk.message
      if (msg?.content) {
        content += msg.content
      }
      ingestToolCalls(msg?.tool_calls)
    }
  }

  if (buffer.trim()) {
    try {
      const chunk = JSON.parse(buffer.trim()) as OllamaChatChunk
      options.onChunk(chunk)
      if (chunk.message?.content) content += chunk.message.content
      ingestToolCalls(chunk.message?.tool_calls)
    } catch {
      // ignore trailing partial
    }
  }

  return { content, toolCalls }
}

export function toOllamaMessages(messages: ChatMessage[]): OllamaChatMessage[] {
  return messages.map((m) => {
    const out: OllamaChatMessage = {
      role: m.role,
      content: m.content
    }
    if (m.images?.length) {
      out.images = m.images
    }
    if (m.tool_calls?.length) {
      out.tool_calls = m.tool_calls.map((tc) => ({
        function: {
          name: tc.name,
          arguments: tc.arguments
        }
      }))
    }
    if (m.tool_name) {
      out.tool_name = m.tool_name
    }
    return out
  })
}

export async function showModel(model: string): Promise<OllamaModelDetails> {
  const baseUrl = getOllamaBaseUrl()
  const res = await fetch(`${baseUrl}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model })
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Failed to show model: HTTP ${res.status}${text ? ` — ${text}` : ''}`
    )
  }
  const data = (await res.json()) as {
    modelfile?: string
    parameters?: string
    template?: string
    system?: string
    details?: OllamaModelDetails['details']
    capabilities?: string[]
    model_info?: Record<string, unknown>
  }

  let size: number | undefined
  let modifiedAt: string | undefined
  try {
    const tagsRes = await fetch(`${baseUrl}/api/tags`)
    if (tagsRes.ok) {
      const tags = (await tagsRes.json()) as {
        models?: Array<{ name: string; size: number; modified_at: string }>
      }
      const match = tags.models?.find((m) => m.name === model)
      if (match) {
        size = match.size
        modifiedAt = match.modified_at
      }
    }
  } catch {
    // optional enrichment
  }

  return {
    name: model,
    modelfile: data.modelfile,
    parameters: data.parameters,
    template: data.template,
    system: data.system,
    details: data.details,
    capabilities: data.capabilities,
    model_info: data.model_info,
    size,
    modifiedAt
  }
}

export async function deleteModel(model: string): Promise<void> {
  const baseUrl = getOllamaBaseUrl()
  const res = await fetch(`${baseUrl}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model })
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Failed to delete model: HTTP ${res.status}${text ? ` — ${text}` : ''}`
    )
  }
}

let pullAbort: AbortController | null = null

export function abortPull(): void {
  if (pullAbort) {
    pullAbort.abort()
    pullAbort = null
  }
}

export async function pullModel(
  model: string,
  onProgress: (event: PullProgressEvent) => void
): Promise<void> {
  abortPull()
  const abort = new AbortController()
  pullAbort = abort
  const baseUrl = getOllamaBaseUrl()

  try {
    const res = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `name` kept for older Ollama builds; `model` is the current field.
      body: JSON.stringify({ model, name: model, stream: true }),
      signal: abort.signal
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(
        `Failed to pull model: HTTP ${res.status}${text ? ` — ${text}` : ''}`
      )
    }
    if (!res.body) {
      throw new Error('Ollama pull returned no body')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let chunk: {
          status?: string
          digest?: string
          total?: number
          completed?: number
          error?: string
        }
        try {
          chunk = JSON.parse(trimmed) as typeof chunk
        } catch {
          continue
        }
        if (chunk.error) {
          const message =
            /file does not exist/i.test(chunk.error) &&
            (/:cloud$|-cloud$/i.test(model) || /cloud/i.test(model))
              ? `"${model}" is a cloud tag and cannot be pulled as a local model. Choose a local tag with a size.`
              : /file does not exist/i.test(chunk.error)
                ? `Model "${model}" was not found in the registry. Pick a specific local tag from the model details.`
                : chunk.error
          onProgress({
            model,
            status: 'error',
            error: message,
            done: true
          })
          throw new Error(message)
        }
        onProgress({
          model,
          status: chunk.status ?? 'pulling',
          digest: chunk.digest,
          total: chunk.total,
          completed: chunk.completed,
          done: chunk.status === 'success'
        })
      }
    }

    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer.trim()) as {
          status?: string
          digest?: string
          total?: number
          completed?: number
          error?: string
        }
        if (chunk.error) throw new Error(chunk.error)
        onProgress({
          model,
          status: chunk.status ?? 'success',
          digest: chunk.digest,
          total: chunk.total,
          completed: chunk.completed,
          done: true
        })
      } catch (err) {
        if (err instanceof SyntaxError) {
          // ignore trailing partial
        } else {
          throw err
        }
      }
    }

    onProgress({ model, status: 'success', done: true })
  } catch (err) {
    if (abort.signal.aborted) {
      onProgress({ model, status: 'aborted', error: 'Aborted', done: true })
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    onProgress({ model, status: 'error', error: message, done: true })
    throw err
  } finally {
    if (pullAbort === abort) pullAbort = null
  }
}
