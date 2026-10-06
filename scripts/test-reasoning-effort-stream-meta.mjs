import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const { resolveReasoningEffortForRequest } = await server.ssrLoadModule(
  new URL('../src/shared/reasoning-effort.ts', import.meta.url).pathname
)
after(() => server.close())

test('tools force none on reasoning models', () => {
  assert.equal(
    resolveReasoningEffortForRequest({
      model: 'gpt-5',
      hasTools: true,
      preference: 'high'
    }),
    'none'
  )
})

test('no tools uses preference', () => {
  assert.equal(
    resolveReasoningEffortForRequest({
      model: 'gpt-5',
      hasTools: false,
      preference: 'medium'
    }),
    'medium'
  )
})

test('non-reasoning model omits effort', () => {
  assert.equal(
    resolveReasoningEffortForRequest({
      model: 'gpt-4o',
      hasTools: false,
      preference: 'low'
    }),
    undefined
  )
})
