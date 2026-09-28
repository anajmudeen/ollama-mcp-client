import {
  getOpenaiApiKey,
  getOpenaiEnabled,
  getImageBackend,
  getOpenaiModelEnabledMap,
  getOpenaiModelsCatalog,
  getOpenaiValidationState
} from './config-store'
import { isOpenAiImageGenModel } from '../shared/openai-models'
import type {
  AvailableImageModel,
  ImageBackendSelection,
  ImageGenerationRequest,
  ImageGenerationResult,
  LlmProvider
} from '../shared/types'
import { generateImageBase64 } from './ollama-image'
import {
  editOpenAiImageBase64,
  generateOpenAiImageBase64,
  type OpenAiImageGenerateResult,
  type OpenAiImageSource
} from './openai-image'
import {
  getOllamaStatus,
  listModels,
  modelIsImageGen,
  type OllamaTool
} from './ollama'

export const GENERATE_IMAGE_NAME = 'generate_image'
export const EDIT_IMAGE_NAME = 'edit_image'

/** Pure: pick configured model if still in list, else first, else null. */
export function resolveDefaultImageModel(
  configured: string | null,
  imageModelNames: string[]
): string | null {
  if (imageModelNames.length === 0) return null
  if (configured && imageModelNames.includes(configured)) return configured
  return imageModelNames[0] ?? null
}

export function resolveImageModelForProvider(
  provider: LlmProvider,
  configured: string | null,
  availableModels: string[]
): string | null {
  if (provider === 'openai') {
    return resolveDefaultImageModel(configured, availableModels)
  }
  return resolveDefaultImageModel(configured, availableModels)
}

export function isImageModelAvailable(
  _provider: LlmProvider,
  model: string,
  availableModels: string[]
): boolean {
  return availableModels.includes(model)
}

export function resolveImageBackend(
  selection: ImageBackendSelection | null,
  available: AvailableImageModel[]
): AvailableImageModel | null {
  if (!selection) return null
  return available.find(
    (entry) =>
      entry.provider === selection.provider && entry.model === selection.model
  ) ?? null
}

export async function listInstalledImageModelNames(): Promise<string[]> {
  const models = await listModels()
  return models
    .filter((m) => modelIsImageGen(m.name, { capabilities: m.capabilities }))
    .map((m) => m.name)
}

export async function listAvailableImageModels(): Promise<AvailableImageModel[]> {
  const imageModels: AvailableImageModel[] = []

  const ollamaStatus = await getOllamaStatus()
  if (ollamaStatus.ok && ollamaStatus.imageGenSupported !== false) {
    try {
      const names = await listInstalledImageModelNames()
      imageModels.push(
        ...names.map((model) => ({ provider: 'ollama' as const, model }))
      )
    } catch {
      // OpenAI image models can still be used when Ollama is unavailable.
    }
  }

  const { ok: openaiValidated } = getOpenaiValidationState()
  if (getOpenaiEnabled() && Boolean(getOpenaiApiKey()) && openaiValidated) {
    const catalog = getOpenaiModelsCatalog()
    const enabled = getOpenaiModelEnabledMap()
    imageModels.push(
      ...catalog
        .map((entry) => entry.id)
        .filter((id) => enabled[id] === true && isOpenAiImageGenModel(id))
        .map((model) => ({ provider: 'openai' as const, model }))
    )
  }

  return imageModels
}

export async function listAvailableImageModelNames(
  provider: LlmProvider
): Promise<string[]> {
  if (provider === 'openai') {
    const { ok: openaiValidated } = getOpenaiValidationState()
    if (!getOpenaiEnabled() || !getOpenaiApiKey() || !openaiValidated) return []
    const catalog = getOpenaiModelsCatalog()
    const enabled = getOpenaiModelEnabledMap()
    return catalog
      .map((entry) => entry.id)
      .filter((id) => enabled[id] === true && isOpenAiImageGenModel(id))
  }

  const status = await getOllamaStatus()
  if (!status.ok || status.imageGenSupported === false) return []
  try {
    return await listInstalledImageModelNames()
  } catch {
    return []
  }
}

export async function generateImageForBackend(
  request: ImageGenerationRequest,
  signal?: AbortSignal
): Promise<ImageGenerationResult> {
  if (request?.provider !== 'ollama' && request?.provider !== 'openai') {
    return { ok: false, message: 'Invalid image provider' }
  }
  const model = typeof request.model === 'string' ? request.model.trim() : ''
  const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : ''
  if (!prompt) return { ok: false, message: 'Prompt must not be blank' }

  try {
    const available = await listAvailableImageModels()
    const selected = available.find(
      (entry) => entry.provider === request.provider && entry.model === model
    )
    if (!selected) {
      return { ok: false, message: 'Selected image model is unavailable' }
    }
    const generated =
      request.provider === 'openai'
        ? await generateOpenAiImageBase64(model, prompt, signal)
        : { b64: await generateImageBase64(model, prompt, signal) }
    return {
      ok: true,
      provider: request.provider,
      model,
      imageBase64: generated.b64,
      mime: 'image/png'
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export function shouldOfferGenerateImageTool(
  provider: LlmProvider,
  selectedModel: string
): Promise<boolean>
export function shouldOfferGenerateImageTool(selectedModel: string): Promise<boolean>
export async function shouldOfferGenerateImageTool(
  providerOrSelectedModel: LlmProvider | string,
  selectedModelArg?: string
): Promise<boolean> {
  const provider =
    selectedModelArg === undefined
      ? 'ollama'
      : (providerOrSelectedModel as LlmProvider)
  const selectedModel = selectedModelArg ?? providerOrSelectedModel
  if (provider === 'openai' && isOpenAiImageGenModel(selectedModel)) {
    return false
  }
  if (provider === 'ollama' && modelIsImageGen(selectedModel)) {
    return false
  }
  return resolveImageBackend(getImageBackend(), await listAvailableImageModels()) !== null
}

export function generateImageToolDefinition(): OllamaTool {
  return {
    type: 'function',
    function: {
      name: GENERATE_IMAGE_NAME,
      description:
        'Generate an actual image from a text prompt using the configured image model. Use this only when the user wants a new image created. Do not use it for editing source images, writing image prompts, describing scenes, or suggesting image ideas.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Full image-generation prompt'
          }
        },
        required: ['prompt']
      }
    }
  }
}

export function editImageToolDefinition(): OllamaTool {
  return {
    type: 'function',
    function: {
      name: EDIT_IMAGE_NAME,
      description:
        'Edit a supplied source image according to a text prompt using the configured image model. Use this only when the user wants an existing image changed, not when creating a new image from scratch.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Full image-editing prompt'
          }
        },
        required: ['prompt']
      }
    }
  }
}

export type GenerateImageToolResult =
  | {
      ok: true
      model: string
      imageBase64: string
      message: string
      usage?: OpenAiImageGenerateResult['usage']
    }
  | { ok: false; message: string }

export async function runGenerateImageTool(
  _provider: LlmProvider,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<GenerateImageToolResult> {
  const prompt = String(args.prompt ?? '').trim()
  if (!prompt) {
    return { ok: false, message: 'Missing required argument: prompt' }
  }

  try {
    const available = await listAvailableImageModels()
    const backend = resolveImageBackend(getImageBackend(), available)
    if (!backend) {
      const selected = getImageBackend()
      return {
        ok: false,
        message:
          selected
            ? 'The selected image backend is unavailable. Select an available image backend and try again.'
            : 'No image backend selected. Select an image backend to generate images.'
      }
    }

    const generated =
      backend.provider === 'openai'
        ? await generateOpenAiImageBase64(backend.model, prompt, signal)
        : { b64: await generateImageBase64(backend.model, prompt, signal) }
    return {
      ok: true,
      model: backend.model,
      imageBase64: generated.b64,
      message: `Generated image with ${backend.model} via ${backend.provider}`,
      ...(generated.usage ? { usage: generated.usage } : {})
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, message }
  }
}

export async function runEditImageTool(
  _provider: LlmProvider,
  prompt: string,
  images: Array<string | OpenAiImageSource>,
  signal?: AbortSignal
): Promise<GenerateImageToolResult> {
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) {
    return { ok: false, message: 'Missing required argument: prompt' }
  }
  if (
    !Array.isArray(images) ||
    images.some((image) => {
      const base64 = typeof image === 'string' ? image : image?.base64
      return typeof base64 !== 'string' || base64.length === 0
    })
  ) {
    return { ok: false, message: 'Source images must be non-empty strings' }
  }
  const selectedImages = images.filter((image, index) =>
    images.findIndex((candidate) =>
      typeof candidate === 'string' && typeof image === 'string'
        ? candidate === image
        : (typeof candidate === 'string' ? candidate : candidate.base64) ===
          (typeof image === 'string' ? image : image.base64)
    ) === index
  )
  if (selectedImages.length === 0) {
    return {
      ok: false,
      message: 'Upload or generate an image first before editing.'
    }
  }

  try {
    const available = await listAvailableImageModels()
    const backend = resolveImageBackend(getImageBackend(), available)
    if (!backend) {
      const selected = getImageBackend()
      return {
        ok: false,
        message:
          selected
            ? 'The selected image backend is unavailable. Select an available image backend and try again.'
            : 'No image backend selected. Select an image backend to edit images.'
      }
    }
    if (backend.provider === 'ollama') {
      return {
        ok: false,
        message:
          'Image editing requires an OpenAI image model. Select an OpenAI image model and try again.'
      }
    }

    const result = await editOpenAiImageBase64(
      backend.model,
      normalizedPrompt,
      selectedImages,
      signal
    )
    return {
      ok: true,
      model: backend.model,
      imageBase64: result.b64,
      message: `Edited image with ${backend.model} via ${backend.provider}`,
      ...(result.usage ? { usage: result.usage } : {})
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, message }
  }
}
