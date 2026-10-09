import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const msgMod = await server.ssrLoadModule(
  new URL('../src/shared/ollama-offline-message.ts', import.meta.url).pathname
)
const bannerMod = await server.ssrLoadModule(
  new URL('../src/shared/chat-provider-banners.ts', import.meta.url).pathname
)
after(() => server.close())

test('OLLAMA_OFFLINE_USER_MESSAGE matches native Ollama offline chat banner', () => {
  const banners = bannerMod.chatProviderReadinessBanners({
    configuredProvider: 'ollama',
    effectiveProvider: 'ollama',
    ollamaOk: false
  })
  assert.deepEqual(banners, [msgMod.OLLAMA_OFFLINE_USER_MESSAGE])
})
