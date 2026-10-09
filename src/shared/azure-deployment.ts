import { openAiModelUsesReasoningEffort } from './openai-models'
import type { AzureOpenaiDeploymentEntry } from './types'

export function defaultReasoningEffortEnabledForModel(model: string | undefined): boolean {
  return openAiModelUsesReasoningEffort((model ?? '').trim())
}

/** Whether chat should offer reasoning effort and Azure may send `reasoning_effort`. */
export function supportsAzureDeploymentReasoning(
  entry: Partial<Pick<AzureOpenaiDeploymentEntry, 'model' | 'reasoningEffortEnabled'>>
): boolean {
  const model = (entry.model ?? '').trim()
  if (!model || !entry.reasoningEffortEnabled) return false
  return openAiModelUsesReasoningEffort(model)
}
