import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const config = await server.ssrLoadModule(
  new URL('../src/main/config-store.ts', import.meta.url).pathname
)
after(() => server.close())

test('migrates legacy selectedModel into Ollama without losing provider slots', () => {
  assert.deepEqual(
    config.migrateSelectedModelByProvider(false, undefined, 'llama3.2'),
    { ollama: 'llama3.2', openai: null, 'azure-openai': null }
  )
  assert.deepEqual(
    config.migrateSelectedModelByProvider(
      true,
      { ollama: 'llama3.2', openai: 'gpt-5', 'azure-openai': 'prod-deploy' },
      'legacy-model'
    ),
    { ollama: 'llama3.2', openai: 'gpt-5', 'azure-openai': 'prod-deploy' }
  )
})
