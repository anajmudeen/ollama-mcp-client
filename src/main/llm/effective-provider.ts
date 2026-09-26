import type { LlmProvider, OpenAiStatus } from '../../shared/types'
import {
  getAzureOpenaiApiKey,
  getAzureOpenaiApiVersion,
  getAzureOpenaiDeployments,
  getAzureOpenaiEnabled,
  getAzureOpenaiEndpoint,
  getAzureOpenaiValidationState,
  getLlmProvider,
  getOpenaiApiKey,
  getOpenaiEnabled,
  getOpenaiModelEnabledMap,
  getOpenaiModelsCatalog,
  getOpenaiValidationState
} from '../config-store'
import { isChatModelId } from '../openai-client'
import { normalizeAzureEndpoint } from '../azure-openai-client'

export interface EffectiveLlmProviderResult {
  configured: LlmProvider
  effective: LlmProvider
  fallback: boolean
  reason?: string
}

export function resolveEffectiveLlmProvider(): EffectiveLlmProviderResult {
  const configured = getLlmProvider()
  if (configured === 'ollama') {
    return { configured, effective: 'ollama', fallback: false }
  }

  if (configured === 'azure-openai') {
    if (!getAzureOpenaiEnabled()) {
      return {
        configured,
        effective: 'ollama',
        fallback: true,
        reason: 'Azure OpenAI is disabled in Settings.'
      }
    }

    if (!getAzureOpenaiApiKey()) {
      return {
        configured,
        effective: 'ollama',
        fallback: true,
        reason: 'Azure OpenAI API key is not configured.'
      }
    }

    if (!getAzureOpenaiEndpoint() || !normalizeAzureEndpoint(getAzureOpenaiEndpoint() ?? '')) {
      return {
        configured,
        effective: 'ollama',
        fallback: true,
        reason: 'Azure OpenAI endpoint is not configured.'
      }
    }

    if (!getAzureOpenaiApiVersion().trim()) {
      return {
        configured,
        effective: 'ollama',
        fallback: true,
        reason: 'Azure OpenAI API version is not configured.'
      }
    }

    const { ok, error } = getAzureOpenaiValidationState()
    if (!ok) {
      return {
        configured,
        effective: 'ollama',
        fallback: true,
        reason: error ?? 'Azure OpenAI configuration is not validated.'
      }
    }

    if (!getAzureOpenaiDeployments().some((deployment) => deployment.enabled && deployment.name.trim())) {
      return {
        configured,
        effective: 'ollama',
        fallback: true,
        reason: 'Azure OpenAI has no enabled deployments.'
      }
    }

    return { configured, effective: 'azure-openai', fallback: false }
  }

  if (!getOpenaiEnabled()) {
    return {
      configured,
      effective: 'ollama',
      fallback: true,
      reason: 'OpenAI is disabled in Settings.'
    }
  }

  if (!getOpenaiApiKey()) {
    return {
      configured,
      effective: 'ollama',
      fallback: true,
      reason: 'OpenAI API key is not configured.'
    }
  }

  const { ok, error } = getOpenaiValidationState()
  if (!ok) {
    return {
      configured,
      effective: 'ollama',
      fallback: true,
      reason: error ?? 'OpenAI API key is not validated.'
    }
  }

  return { configured, effective: 'openai', fallback: false }
}

export function getOpenAiStatus(): OpenAiStatus {
  const enabled = getOpenaiEnabled()
  const { ok, error } = getOpenaiValidationState()
  const catalog = getOpenaiModelsCatalog()
  const enabledMap = getOpenaiModelEnabledMap()
  const enabledCount = catalog.filter((m) => isChatModelId(m.id) && enabledMap[m.id]).length
  return {
    enabled,
    validationOk: ok,
    validationError: error,
    catalogCount: catalog.length,
    enabledCount
  }
}
