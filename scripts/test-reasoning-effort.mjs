import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const mod = await server.ssrLoadModule(
  new URL('../src/shared/reasoning-effort.ts', import.meta.url).pathname
)
after(() => server.close())

test('normalizeReasoningEffort defaults and coerces', () => {
  assert.equal(mod.normalizeReasoningEffort(undefined), 'low')
  assert.equal(mod.normalizeReasoningEffort('medium'), 'medium')
  assert.equal(mod.normalizeReasoningEffort('nope'), 'low')
  assert.equal(mod.DEFAULT_REASONING_EFFORT, 'low')
})

test('resolveReasoningEffortForRequest follows omit / none-with-tools / preference', () => {
  assert.equal(
    mod.resolveReasoningEffortForRequest({
      model: 'gpt-4o',
      hasTools: false,
      preference: 'high'
    }),
    undefined
  )
  assert.equal(
    mod.resolveReasoningEffortForRequest({
      model: 'gpt-5',
      hasTools: true,
      preference: 'high'
    }),
    'none'
  )
  assert.equal(
    mod.resolveReasoningEffortForRequest({
      model: 'gpt-5',
      hasTools: false,
      preference: 'medium'
    }),
    'medium'
  )
  assert.equal(
    mod.resolveReasoningEffortForRequest({
      model: 'o3-mini',
      hasTools: false,
      preference: 'low'
    }),
    'low'
  )
})

test('shouldShowReasoningEffortControl', () => {
  assert.equal(
    mod.shouldShowReasoningEffortControl({ provider: 'ollama', model: 'gpt-5' }),
    false
  )
  assert.equal(
    mod.shouldShowReasoningEffortControl({ provider: 'openai', model: 'gpt-4o' }),
    false
  )
  assert.equal(
    mod.shouldShowReasoningEffortControl({ provider: 'openai', model: 'gpt-5' }),
    true
  )
  assert.equal(
    mod.shouldShowReasoningEffortControl({
      provider: 'azure-openai',
      model: 'my-deploy',
      azureDeployment: { model: 'o3-mini', reasoningEffortEnabled: true }
    }),
    true
  )
  assert.equal(
    mod.shouldShowReasoningEffortControl({
      provider: 'azure-openai',
      model: 'my-deploy',
      azureDeployment: { model: 'o3-mini', reasoningEffortEnabled: false }
    }),
    false
  )
})
