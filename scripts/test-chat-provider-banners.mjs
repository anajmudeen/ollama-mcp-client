import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const mod = await server.ssrLoadModule(
  new URL('../src/shared/chat-provider-banners.ts', import.meta.url).pathname
)
after(() => server.close())

test('configured OpenAI + fallback + Ollama offline does not say switch to OpenAI', () => {
  const banners = mod.chatProviderReadinessBanners({
    configuredProvider: 'openai',
    effectiveProvider: 'ollama',
    ollamaOk: false,
    providerFallbackReason: 'OpenAI API key is not validated.'
  })
  assert.equal(banners.length, 1)
  assert.match(banners[0], /OpenAI is unavailable/)
  assert.match(banners[0], /Ollama fallback is also offline/)
  assert.doesNotMatch(banners[0], /switch to OpenAI/)
})

test('configured OpenAI + fallback + Ollama online explains Ollama fallback', () => {
  const banners = mod.chatProviderReadinessBanners({
    configuredProvider: 'openai',
    effectiveProvider: 'ollama',
    ollamaOk: true,
    providerFallbackReason: 'OpenAI is disabled in Settings.'
  })
  assert.equal(banners.length, 1)
  assert.match(banners[0], /will use Ollama instead/)
  assert.match(banners[0], /OpenAI is disabled/)
})

test('configured Azure + fallback + Ollama offline mirrors OpenAI messaging', () => {
  const banners = mod.chatProviderReadinessBanners({
    configuredProvider: 'azure-openai',
    effectiveProvider: 'ollama',
    ollamaOk: false,
    providerFallbackReason: 'Azure OpenAI endpoint is not configured.'
  })
  assert.equal(banners.length, 1)
  assert.match(banners[0], /Azure OpenAI is unavailable/)
  assert.doesNotMatch(banners[0], /switch to OpenAI/)
})

test('native Ollama offline keeps switch-to-OpenAI hint', () => {
  const banners = mod.chatProviderReadinessBanners({
    configuredProvider: 'ollama',
    effectiveProvider: 'ollama',
    ollamaOk: false
  })
  assert.deepEqual(banners, [
    'Ollama is offline — check Settings or switch to OpenAI.'
  ])
})

test('ready OpenAI ignores Ollama offline', () => {
  const banners = mod.chatProviderReadinessBanners({
    configuredProvider: 'openai',
    effectiveProvider: 'openai',
    ollamaOk: false
  })
  assert.deepEqual(banners, [])
})
