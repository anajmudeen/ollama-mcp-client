import type { ImageGalleryItem } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value
    ) && Number.isFinite(Date.parse(value))
  )
}

function normalizeItem(value: unknown): ImageGalleryItem | null {
  if (!isRecord(value)) return null

  const provider = value.provider
  const id = nonEmptyString(value.id) ? value.id.trim() : ''
  const imageBase64 = nonEmptyString(value.imageBase64) ? value.imageBase64.trim() : ''
  const mime = nonEmptyString(value.mime) ? value.mime.trim() : ''
  const prompt = nonEmptyString(value.prompt) ? value.prompt.trim() : ''
  const model = nonEmptyString(value.model) ? value.model.trim() : ''
  const createdAt = nonEmptyString(value.createdAt) ? value.createdAt.trim() : ''

  if (
    !id ||
    !imageBase64 ||
    !/^image\/[a-z0-9.+-]+$/i.test(mime) ||
    !prompt ||
    !model ||
    (provider !== 'ollama' && provider !== 'openai') ||
    !createdAt ||
    !isIsoTimestamp(createdAt)
  ) {
    return null
  }

  return {
    id,
    imageBase64,
    mime,
    prompt,
    provider,
    model,
    createdAt
  }
}

export function normalizeImageGallery(value: unknown): ImageGalleryItem[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const normalized: ImageGalleryItem[] = []
  for (const candidate of value) {
    const item = normalizeItem(candidate)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    normalized.push(item)
  }
  return normalized
}

export function sortImageGalleryItems(items: ImageGalleryItem[]): ImageGalleryItem[] {
  return [...items].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  )
}
