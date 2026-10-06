import type { OllamaModel } from '../../shared/types'
import { isOpenAiVisionModel } from '../../shared/openai-models'
import {
  getAzureOpenaiApiKey,
  getAzureOpenaiApiVersion,
  getAzureOpenaiDeployments,
  getAzureOpenaiEndpoint
} from '../config-store'
import {
  azureOpenAiChatOnce,
  azureOpenAiChatStream,
  normalizeAzureEndpoint
} from '../azure-openai-client'
import type { LlmModelInfo, LlmProvider } from './types'

const DEFAULT_CTX = 128_000

export function azureDeploymentTags(deploymentName: string): string[] {
  const tags = ['azure-openai']
  if (isOpenAiVisionModel(deploymentName)) tags.push('vision')
  return tags
}

function azureOptions(deployment: string) {
  const endpoint = getAzureOpenaiEndpoint()
  const apiKey = getAzureOpenaiApiKey()
  const apiVersion = getAzureOpenaiApiVersion()
  if (!endpoint || !apiKey || !apiVersion) {
    throw new Error('Azure OpenAI is not fully configured.')
  }
  return {
    endpoint: normalizeAzureEndpoint(endpoint),
    apiKey,
    apiVersion,
    deployment
  }
}

export const azureOpenaiLlmProvider: LlmProvider = {
  id: 'azure-openai',

  async chatStream(options) {
    const result = await azureOpenAiChatStream({
      ...azureOptions(options.model),
      messages: options.messages,
      tools: options.tools,
      signal: options.signal,
      onChunk: options.onChunk
    })
    options.onChunk({ done: true })
    return {
      content: result.content,
      toolCalls: result.toolCalls,
      promptEvalCount: result.promptEvalCount,
      evalCount: result.evalCount,
      usage: result.usage,
      reasoningEffortSent: result.reasoningEffortSent
    }
  },

  chatOnce(options) {
    return azureOpenAiChatOnce({
      ...azureOptions(options.model),
      messages: options.messages,
      signal: options.signal
    })
  },

  async listModelsForChat(): Promise<OllamaModel[]> {
    return getAzureOpenaiDeployments()
      .map((deployment) => ({ ...deployment, name: deployment.name.trim() }))
      .filter((deployment) => deployment.enabled && deployment.name)
      .map((deployment) => {
        const tags = azureDeploymentTags(deployment.name)
        return {
          name: deployment.name,
          size: 0,
          modifiedAt: '',
          tags,
          capabilities: tags
        }
      })
  },

  async getModelInfo(model) {
    const deployment = getAzureOpenaiDeployments().find(
      (entry) => entry.name.trim() === model.trim()
    )
    if (!deployment) return null
    const tags = azureDeploymentTags(deployment.name)
    return {
      capabilities: tags,
      contextLength: DEFAULT_CTX,
      catalogModelId: isOpenAiVisionModel(deployment.name) ? deployment.name : undefined
    }
  },

  modelIsImageGen() {
    return false
  },

  detectVisionSupport(_model, info) {
    if (info?.capabilities?.includes('vision')) return 'yes'
    if (info?.catalogModelId && isOpenAiVisionModel(info.catalogModelId)) return 'yes'
    return 'unknown'
  },

  async resolveContextLength(_model, info) {
    return info?.contextLength ?? DEFAULT_CTX
  }
}
