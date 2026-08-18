import type { OllamaModel } from '../shared/types'
import { getSelectedModel } from './config-store'
import { chatOnce, listModels, modelIsImageGen } from './ollama'

const TITLE_SYSTEM =
  'You write short chat titles. Reply with only a concise title, 3-8 words, no quotes, no trailing punctuation, no explanation.'
const MAX_PROMPT_CHARS = 500
const MAX_TITLE_CHARS = 60
const MAX_TITLE_WORDS = 12
const KEEP_WORDS = 8

function hasCapability(model: OllamaModel, name: string): boolean {
  return (model.capabilities ?? []).some((c) => c.toLowerCase() === name)
}

export function pickSmallestChatModel(models: OllamaModel[]): string | null {
  const eligible = models.filter((m) => {
    if (hasCapability(m, 'embedding')) return false
    if (hasCapability(m, 'image')) return false
    if (modelIsImageGen(m.name, { capabilities: m.capabilities })) return false
    return true
  })
  if (eligible.length === 0) return null

  let smallest = eligible[0]
  for (const model of eligible) {
    const size = model.size > 0 ? model.size : Number.POSITIVE_INFINITY
    const best = smallest.size > 0 ? smallest.size : Number.POSITIVE_INFINITY
    if (size < best) smallest = model
  }
  return smallest.name
}

export function sanitizeTitle(raw: string, fallback: string): string {
  let text = (raw.split(/\r?\n/)[0] ?? '').trim()
  text = text.replace(/^[#>*\-\s]+/, '')
  text = text.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
  text = text.replace(/\*+/g, '').replace(/^Title:\s*/i, '')
  text = text.replace(/\s+/g, ' ').trim()
  text = text.replace(/[.!,;:]+$/g, '')
  if (!text) return fallback

  const words = text.split(' ')
  if (words.length > MAX_TITLE_WORDS) {
    text = words.slice(0, KEEP_WORDS).join(' ')
  }
  if (text.length > MAX_TITLE_CHARS) {
    text = text.slice(0, MAX_TITLE_CHARS).trim()
  }
  return text || fallback
}

export function snippetFromPrompt(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'New chat'
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned
}

export async function generateSessionTitle(
  prompt: string,
  fallback: string
): Promise<string> {
  const query = prompt.replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT_CHARS)
  if (!query) return fallback

  let models: OllamaModel[]
  try {
    models = await listModels()
  } catch {
    return fallback
  }

  const model = pickSmallestChatModel(models)
  if (!model) return fallback

  const selected = getSelectedModel()
  try {
    const raw = await chatOnce({
      model,
      numPredict: 24,
      numCtx: 512,
      keepAlive: selected && model !== selected ? 0 : undefined,
      messages: [
        { role: 'system', content: TITLE_SYSTEM },
        { role: 'user', content: `Write a title for this chat:\n\n${query}` }
      ]
    })
    return sanitizeTitle(raw, fallback)
  } catch {
    return fallback
  }
}
