import { supportsAzureDeploymentReasoning } from './azure-deployment'
import { openAiModelUsesReasoningEffort } from './openai-models'
import type { AzureOpenaiDeploymentEntry, LlmProvider } from './types'

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high'
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'low'
const ALLOWED = new Set<ReasoningEffort>(['none', 'low', 'medium', 'high'])

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return typeof value === 'string' && ALLOWED.has(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : DEFAULT_REASONING_EFFORT
}

export function resolveReasoningEffortForRequest(options: {
  model: string
  hasTools: boolean
  preference: ReasoningEffort
}): ReasoningEffort | undefined {
  if (!openAiModelUsesReasoningEffort(options.model)) return undefined
  if (options.hasTools) return 'none'
  return normalizeReasoningEffort(options.preference)
}

export function shouldShowReasoningEffortControl(options: {
  provider: LlmProvider
  /** Chat model id: OpenAI model id or Azure deployment name. */
  model: string | null
  azureDeployment?: Pick<
    AzureOpenaiDeploymentEntry,
    'model' | 'reasoningEffortEnabled'
  > | null
}): boolean {
  if (options.provider === 'ollama') return false
  if (!options.model?.trim()) return false
  if (options.provider === 'azure-openai') {
    if (!options.azureDeployment) return false
    return supportsAzureDeploymentReasoning(options.azureDeployment)
  }
  return openAiModelUsesReasoningEffort(options.model)
}
