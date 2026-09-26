import type { LlmProvider, SelectedModelByProvider } from './types'

export function selectedModelForProvider(
  slots: SelectedModelByProvider,
  provider: LlmProvider
): string | null {
  return slots[provider] ?? null
}
