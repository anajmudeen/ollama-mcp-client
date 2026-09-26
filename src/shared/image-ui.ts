import type { LlmProvider, OllamaModel } from './types'
import { isOpenAiImageGenModel } from './openai-models'

export type ImageUiBehavior = 'ollama' | 'openai' | null

const OLLAMA_IMAGE_MODEL_RE =
  /z-image|flux|sdxl|stable-diffusion|stable_diffusion|imagen|dreamshaper|animagine/i

export function classifyImageUiModel(
  provider: LlmProvider,
  model: string,
  metadata?: Pick<OllamaModel, 'tags' | 'capabilities'> | null
): ImageUiBehavior {
  if (provider === 'ollama') {
    const isImage =
      metadata?.tags?.some((tag) => tag.toLowerCase() === 'image') ||
      metadata?.capabilities?.some((capability) => capability.toLowerCase() === 'image') ||
      OLLAMA_IMAGE_MODEL_RE.test(model)
    return isImage ? 'ollama' : null
  }
  if (provider === 'openai' && isOpenAiImageGenModel(model)) return 'openai'
  return null
}
