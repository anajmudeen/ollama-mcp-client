import type {
  AzureOpenaiDeploymentEntry,
  AzureOpenaiModelEntry,
  OllamaModel
} from '../../shared/types'
import { isOpenAiVisionModel } from '../../shared/openai-models'
import {
  getAzureOpenaiApiKey,
  getAzureOpenaiApiVersion,
  getAzureOpenaiDeployments,
  getAzureOpenaiEndpoint,
  getAzureOpenaiModelsCatalog
} from '../config-store'
import {
  azureOpenAiChatOnce,
  azureOpenAiChatStream,
  normalizeAzureEndpoint
} from '../azure-openai-client'
import type { LlmModelInfo, LlmProvider } from './types'

const DEFAULT_CTX = 128_000

function catalogForDeployment(
  deployment: AzureOpenaiDeploymentEntry,
  catalog: AzureOpenaiModelEntry[]
): AzureOpenaiModelEntry | undefined {
  return deployment.matchedCatalogMetadata ?? catalog.find((entry) => entry.id === deployment.name)
}

function hasVisionCapability(capabilities: string[] | undefined): boolean {
  return Boolean(
    capabilities?.some((capability) =>
      /^(vision|image[_-]?input|image[_-]?understanding|multimodal)$/i.test(capability)
    )
  )
}

function isImageGenerationCapability(capability: string): boolean {
  return /(?:image[_ -]?generation|image[_ -]?gen|text[_ -]?to[_ -]?image|dall[- ]?e)/i.test(
    capability
  )
}

function azureModelTags(
  deployment: AzureOpenaiDeploymentEntry,
  catalog: AzureOpenaiModelEntry[]
): string[] {
  const matched = catalogForDeployment(deployment, catalog)
  const tags = ['azure-openai']
  if (matched?.capabilities?.length) {
    tags.push(...matched.capabilities.filter((capability) => !isImageGenerationCapability(capability)))
  }
  if (
    hasVisionCapability(matched?.capabilities) ||
    (matched?.id !== undefined && isOpenAiVisionModel(matched.id))
  ) {
    tags.push('vision')
  }
  return [...new Set(tags)]
}

function modelInfo(
  deployment: AzureOpenaiDeploymentEntry,
  catalog: AzureOpenaiModelEntry[]
): LlmModelInfo {
  const matched = catalogForDeployment(deployment, catalog)
  return {
    capabilities: azureModelTags(deployment, catalog),
    contextLength: DEFAULT_CTX,
    catalogModelId: matched?.id
  }
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
      usage: result.usage
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
    const catalog = getAzureOpenaiModelsCatalog()
    return getAzureOpenaiDeployments()
      .map((deployment) => ({ ...deployment, name: deployment.name.trim() }))
      .filter((deployment) => deployment.enabled && deployment.name)
      .map((deployment) => {
        const matched = catalogForDeployment(deployment, catalog)
        const tags = azureModelTags(deployment, catalog)
        return {
          name: deployment.name,
          size: 0,
          modifiedAt: matched?.created ? new Date(matched.created * 1000).toISOString() : '',
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
    return modelInfo(deployment, getAzureOpenaiModelsCatalog())
  },

  modelIsImageGen() {
    return false
  },

  detectVisionSupport(_model, info) {
    if (hasVisionCapability(info?.capabilities)) return 'yes'
    if (info?.catalogModelId && isOpenAiVisionModel(info.catalogModelId)) return 'yes'
    return 'unknown'
  },

  async resolveContextLength(_model, info) {
    return info?.contextLength ?? DEFAULT_CTX
  }
}
