import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const store = await server.ssrLoadModule(
  new URL('../src/main/config-store.ts', import.meta.url).pathname
)
after(() => server.close())

test('getAzureOpenaiModelsCatalog always returns empty and clears store', () => {
  store.setAzureOpenaiModelsCatalog([{ id: 'gpt-4o', capabilities: ['chat'] }])
  assert.deepEqual(store.getAzureOpenaiModelsCatalog(), [])
  assert.deepEqual(store.getAzureOpenaiModelsCatalog(), [])
})

test('deployments read/write strip matchedCatalogMetadata', () => {
  // reset via remove all then add
  for (const d of store.getAzureOpenaiDeployments()) {
    store.removeAzureOpenaiDeployment(d.name)
  }
  store.addAzureOpenaiDeployment({
    name: 'my-gpt4o',
    enabled: true,
    matchedCatalogMetadata: { id: 'gpt-4o', capabilities: ['vision'] }
  })
  const listed = store.getAzureOpenaiDeployments()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].name, 'my-gpt4o')
  assert.equal(listed[0].enabled, true)
  assert.equal('matchedCatalogMetadata' in listed[0], false)
})

test('azure deployment tags use name heuristics without catalog', async () => {
  const provider = await server.ssrLoadModule(
    new URL('../src/main/llm/azure-openai-provider.ts', import.meta.url).pathname
  )
  assert.deepEqual(provider.azureDeploymentTags('gpt-4o').sort(), ['azure-openai', 'vision'].sort())
  assert.deepEqual(provider.azureDeploymentTags('my-custom-deploy'), ['azure-openai'])
})

test('azure status counts never report catalog', async () => {
  const mod = await server.ssrLoadModule(
    new URL('../src/shared/azure-openai-status.ts', import.meta.url).pathname
  )
  assert.deepEqual(
    mod.azureOpenaiStatusCounts([{ enabled: true }, { enabled: false }]),
    {
      catalogCount: 0,
      enabledCount: 1,
      deploymentCount: 2,
      enabledDeploymentCount: 1
    }
  )
})
