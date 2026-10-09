import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const azureMod = await server.ssrLoadModule(
  new URL('../src/shared/azure-deployment.ts', import.meta.url).pathname
)
after(() => server.close())

test('defaultReasoningEffortEnabledForModel follows OpenAI heuristic', () => {
  assert.equal(azureMod.defaultReasoningEffortEnabledForModel('gpt-5'), true)
  assert.equal(azureMod.defaultReasoningEffortEnabledForModel('gpt-4o'), false)
})

test('supportsAzureDeploymentReasoning requires model, checkbox, and heuristic', () => {
  assert.equal(
    azureMod.supportsAzureDeploymentReasoning({
      model: 'gpt-5',
      reasoningEffortEnabled: true
    }),
    true
  )
  assert.equal(
    azureMod.supportsAzureDeploymentReasoning({
      model: 'gpt-5',
      reasoningEffortEnabled: false
    }),
    false
  )
  assert.equal(
    azureMod.supportsAzureDeploymentReasoning({
      model: 'gpt-4o',
      reasoningEffortEnabled: true
    }),
    false
  )
  assert.equal(
    azureMod.supportsAzureDeploymentReasoning({
      model: '',
      reasoningEffortEnabled: true
    }),
    false
  )
})
