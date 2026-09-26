import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const { migrateImageBackend } = await server.ssrLoadModule(
  new URL('../src/main/config-store.ts', import.meta.url).pathname
)
after(() => server.close())

test('migrates a legacy OpenAI image model first', () => {
  assert.deepEqual(
    migrateImageBackend(' gpt-image-1 ', null, ['gpt-image-1'], ['gpt-image-1']),
    { provider: 'openai', model: 'gpt-image-1' }
  )
})

test('migrates a legacy Ollama image model when verified as installed', () => {
  assert.deepEqual(
    migrateImageBackend(' flux ', null, [], ['flux']),
    { provider: 'ollama', model: 'flux' }
  )
})

test('does not migrate an unresolved legacy model', () => {
  assert.equal(migrateImageBackend('unknown', null, [], []), null)
})

test('normalizes and preserves a structured selection', () => {
  assert.deepEqual(
    migrateImageBackend('legacy', { provider: 'ollama', model: ' flux ' }, [], []),
    { provider: 'ollama', model: 'flux' }
  )
})

test('preserves provider identity when model names collide', () => {
  assert.deepEqual(
    migrateImageBackend('same', { provider: 'ollama', model: ' same ' }, ['same'], ['same']),
    { provider: 'ollama', model: 'same' }
  )
})
