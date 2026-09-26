import type { OllamaTool } from './ollama'
import type { LlmProvider } from '../shared/types'
import {
  editImageToolDefinition,
  generateImageToolDefinition,
  shouldOfferGenerateImageTool
} from './image-gen-tool'

export function shouldOfferAgentImageTools(
  provider: LlmProvider,
  model: string
): Promise<boolean> {
  return shouldOfferGenerateImageTool(provider, model)
}

export function buildAgentImageTools(baseTools: OllamaTool[]): OllamaTool[] {
  return [
    ...baseTools,
    generateImageToolDefinition(),
    editImageToolDefinition()
  ]
}
