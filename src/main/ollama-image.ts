import { getOllamaBaseUrl } from './config-store'
import { formatOllamaError } from './ollama'

const DEFAULT_WIDTH = 1024
const DEFAULT_HEIGHT = 1024
const DEFAULT_STEPS = 20
const MAX_ATTEMPTS = 3
const MIN_IMAGE_BYTES = 1024

/** Ollama temporarily removed experimental image gen in v0.32.6+. */
const IMAGE_GEN_UNSUPPORTED_HINT =
  'This Ollama version does not support image-generation models (removed in v0.32.6+). ' +
  'Install Ollama 0.32.5 to use models like x/z-image-turbo, or wait for a release that restores image generation. ' +
  'See https://ollama.com/x/z-image-turbo and https://github.com/ollama/ollama/releases/tag/v0.32.6'

export function pickImageBase64FromOllamaLine(
  obj: Record<string, unknown>
): string | undefined {
  if (typeof obj.image === 'string' && obj.image.length > 0) {
    return obj.image
  }

  const images = obj.images
  if (Array.isArray(images)) {
    for (const item of images) {
      if (typeof item === 'string' && item.length > 0) {
        return item
      }
    }
  }

  const resp = obj.response
  if (typeof resp === 'string' && resp.length > 100 && obj.done === true) {
    return resp.trim()
  }

  return undefined
}

type GenerateBody = {
  model: string
  prompt: string
  stream: boolean
  width: number
  height: number
  steps: number
}

function buildBody(
  model: string,
  prompt: string,
  stream: boolean,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT
): GenerateBody {
  return {
    model,
    prompt,
    stream,
    width,
    height,
    steps: DEFAULT_STEPS
  }
}

function isRetryable(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('unexpected eof') ||
    lower.includes('econnreset') ||
    lower.includes('socket hang up') ||
    lower.includes('http 500') ||
    lower.includes('timeout') ||
    lower.includes('fetch failed')
  )
}

function isImageGenUnsupportedError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('image generation models are not currently supported') ||
    lower.includes('image generation is not currently supported')
  )
}

function formatImageGenError(raw: string, model: string): string {
  if (isImageGenUnsupportedError(raw)) {
    return (
      `Image generation is not available in your Ollama build for "${model}". ` +
      IMAGE_GEN_UNSUPPORTED_HINT
    )
  }
  return formatOllamaError(raw)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function parseNdjsonStream(
  body: ReadableStream<Uint8Array>
): Promise<string | undefined> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalImage: string | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>
        const picked = pickImageBase64FromOllamaLine(obj)
        if (picked) finalImage = picked
      } catch {
        // skip malformed NDJSON
      }
    }
  }

  const tail = buffer.trim()
  if (tail) {
    try {
      const obj = JSON.parse(tail) as Record<string, unknown>
      const picked = pickImageBase64FromOllamaLine(obj)
      if (picked) finalImage = picked
    } catch {
      // ignore
    }
  }

  return finalImage
}

async function generateImageNonStream(
  body: GenerateBody,
  signal?: AbortSignal
): Promise<string | undefined> {
  const baseUrl = getOllamaBaseUrl()
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: false }),
    signal
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      formatImageGenError(
        `Image generation failed: HTTP ${res.status}${text ? ` — ${text}` : ''}`,
        body.model
      )
    )
  }
  const data = (await res.json()) as Record<string, unknown>
  return pickImageBase64FromOllamaLine(data)
}

async function generateImageOnce(
  model: string,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  let streamError: unknown
  let finalImage: string | undefined

  try {
    finalImage = await generateImageNonStream(
      buildBody(model, prompt, false),
      signal
    )
  } catch (error) {
    streamError = error
    const message = error instanceof Error ? error.message : String(error)
    // Don't fall through to stream retry when the server explicitly rejects image gen
    if (isImageGenUnsupportedError(message)) {
      throw error
    }
  }

  if (!finalImage && !signal?.aborted) {
    try {
      const baseUrl = getOllamaBaseUrl()
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(model, prompt, true)),
        signal
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(
          formatImageGenError(
            `Image generation failed: HTTP ${res.status}${text ? ` — ${text}` : ''}`,
            model
          )
        )
      }
      if (!res.body) {
        throw new Error('Image generation returned no body')
      }
      finalImage = await parseNdjsonStream(res.body)
    } catch (error) {
      if (streamError) {
        throw streamError instanceof Error
          ? streamError
          : new Error(String(streamError))
      }
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  if (!finalImage) {
    if (streamError) {
      throw streamError instanceof Error
        ? streamError
        : new Error(String(streamError))
    }
    throw new Error(
      `Image model "${model}" returned no image data. ` +
        'Try another model (e.g. x/z-image-turbo) or check Ollama image API support.'
    )
  }

  const buffer = Buffer.from(finalImage, 'base64')
  if (buffer.length < MIN_IMAGE_BYTES) {
    throw new Error(
      `Image model "${model}" returned an invalid or empty image payload (${buffer.length} bytes)`
    )
  }

  return finalImage
}

/**
 * Generate an image via Ollama /api/generate (non-stream first, stream fallback).
 * Returns raw base64 without a data-URL prefix.
 */
export async function generateImageBase64(
  model: string,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) {
      throw new Error('Aborted')
    }
    try {
      return await generateImageOnce(model, prompt, signal)
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (signal?.aborted || message === 'Aborted') throw error
      if (isImageGenUnsupportedError(message)) throw error
      if (!isRetryable(message) || attempt >= MAX_ATTEMPTS) throw error
      await sleep(2500 * attempt)
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError))
}
