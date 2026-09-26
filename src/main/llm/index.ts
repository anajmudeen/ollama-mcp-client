import type { LlmProvider as LlmProviderId } from '../../shared/types'
import { resolveEffectiveLlmProvider } from './effective-provider'
import { ollamaLlmProvider } from './ollama-provider'
import { openaiLlmProvider } from './openai-provider'
import { azureOpenaiLlmProvider } from './azure-openai-provider'
import type { LlmProvider } from './types'

export function getLlmProvider(id: LlmProviderId): LlmProvider {
  if (id === 'openai') return openaiLlmProvider
  if (id === 'azure-openai') return azureOpenaiLlmProvider
  return ollamaLlmProvider
}

export function getEffectiveLlmProvider(): LlmProvider {
  const { effective } = resolveEffectiveLlmProvider()
  return getLlmProvider(effective)
}

export type { LlmProvider, LlmModelInfo, LlmChatStreamResult } from './types'
export { resolveEffectiveLlmProvider, getOpenAiStatus } from './effective-provider'
