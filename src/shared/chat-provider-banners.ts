import type { LlmProvider } from './types'

export interface ChatProviderBannerInput {
  configuredProvider: LlmProvider
  effectiveProvider: LlmProvider
  ollamaOk: boolean
  providerFallbackReason?: string
}

/** Status lines shown above the chat composer for provider readiness. */
export function chatProviderReadinessBanners(
  input: ChatProviderBannerInput
): string[] {
  const {
    configuredProvider,
    effectiveProvider,
    ollamaOk,
    providerFallbackReason
  } = input
  const banners: string[] = []

  const cloudFallback =
    (configuredProvider === 'openai' || configuredProvider === 'azure-openai') &&
    Boolean(providerFallbackReason)

  if (cloudFallback && providerFallbackReason) {
    const label =
      configuredProvider === 'openai' ? 'OpenAI' : 'Azure OpenAI'
    if (!ollamaOk) {
      banners.push(
        `${label} is unavailable (${providerFallbackReason}). Ollama fallback is also offline — fix ${label} in Settings or start Ollama.`
      )
    } else {
      banners.push(
        `${label} is unavailable, so this message will use Ollama instead. ${providerFallbackReason}`
      )
    }
    return banners
  }

  if (effectiveProvider === 'ollama' && !ollamaOk) {
    banners.push(
      'Ollama is offline — check Settings or switch to OpenAI.'
    )
  }

  return banners
}
