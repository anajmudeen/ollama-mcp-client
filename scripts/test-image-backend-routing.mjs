import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const {
  getConfig,
  getImageBackend,
  migrateImageBackend,
  setDefaultImageModel,
  setImageBackend,
  setOpenaiApiKey,
  setOpenaiModelEnabled,
  setOpenaiModelsCatalog,
} = await server.ssrLoadModule(
  new URL('../src/main/config-store.ts', import.meta.url).pathname
)
const {
  listAvailableImageModels,
  resolveImageBackend,
  runEditImageTool,
  runGenerateImageTool
} = await server.ssrLoadModule(
  new URL('../src/main/image-gen-tool.ts', import.meta.url).pathname
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

test('production migration path identifies a legacy Ollama image model locally', () => {
  setImageBackend(null)
  setDefaultImageModel(' flux-schnell ')
  try {
    assert.deepEqual(getImageBackend(), {
      provider: 'ollama',
      model: 'flux-schnell'
    })
  } finally {
    setImageBackend(null)
    setDefaultImageModel(null)
  }
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

test('does not expose the OpenAI API key through getConfig', () => {
  const config = getConfig()
  assert.equal(config.openaiApiKey, null)
})

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
    async text() {
      return JSON.stringify(body)
    }
  }
}

test('routes Azure chat to the selected Ollama image backend', async () => {
  setImageBackend({ provider: 'ollama', model: 'flux' })
  setOpenaiModelsCatalog([])
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/api/tags')) {
      return response({
        models: [{ name: 'flux', details: { families: ['diffusion'] } }]
      })
    }
    if (url.endsWith('/api/version')) return response({ version: '0.1.0' })
    if (url.endsWith('/api/generate')) {
      return response({ image: Buffer.alloc(1024, 7).toString('base64') })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }
  try {
    const result = await runGenerateImageTool('azure-openai', { prompt: 'a lake' })
    assert.equal(result.ok, true)
    assert.equal(result.model, 'flux')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('discovers Ollama and enabled OpenAI image models independently', async () => {
  setOpenaiModelsCatalog([
    { id: 'gpt-image-1', name: 'gpt-image-1' },
    { id: 'gpt-4.1-mini', name: 'gpt-4.1-mini' }
  ])
  setOpenaiModelEnabled('gpt-image-1', true)
  setOpenaiModelEnabled('gpt-4.1-mini', true)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/api/tags')) {
      return response({
        models: [{ name: 'flux', details: { families: ['diffusion'] } }]
      })
    }
    return response({ version: '0.1.0' })
  }
  try {
    assert.deepEqual(await listAvailableImageModels(), [
      { provider: 'ollama', model: 'flux' },
      { provider: 'openai', model: 'gpt-image-1' }
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('routes Azure chat to the selected OpenAI image backend', async () => {
  setImageBackend({ provider: 'openai', model: 'gpt-image-1' })
  setOpenaiApiKey('test-key')
  setOpenaiModelsCatalog([{ id: 'gpt-image-1', name: 'gpt-image-1' }])
  setOpenaiModelEnabled('gpt-image-1', true)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    response({ data: [{ b64_json: 'openai-image' }] })
  try {
    const result = await runGenerateImageTool('azure-openai', { prompt: 'a lake' })
    assert.deepEqual(result, {
      ok: true,
      model: 'gpt-image-1',
      imageBase64: 'openai-image',
      message: 'Generated image with gpt-image-1 via openai'
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('routes OpenAI chat to a selected Ollama backend without provider fallback', async () => {
  setImageBackend({ provider: 'ollama', model: 'flux' })
  setOpenaiModelsCatalog([{ id: 'gpt-image-1', name: 'gpt-image-1' }])
  setOpenaiModelEnabled('gpt-image-1', true)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/api/tags')) {
      return response({
        models: [{ name: 'flux', details: { families: ['diffusion'] } }]
      })
    }
    if (url.endsWith('/api/version')) return response({ version: '0.1.0' })
    if (url.endsWith('/api/generate')) {
      return response({ image: Buffer.alloc(1024, 7).toString('base64') })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }
  try {
    const result = await runGenerateImageTool('openai', { prompt: 'a lake' })
    assert.equal(result.ok, true)
    assert.equal(result.model, 'flux')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('requires an exact selected backend and rejects no or unavailable selection', async () => {
  assert.equal(
    resolveImageBackend({ provider: 'ollama', model: 'same' }, [
      { provider: 'openai', model: 'same' }
    ]),
    null
  )
  setImageBackend(null)
  assert.deepEqual(
    await runGenerateImageTool('azure-openai', { prompt: 'a lake' }),
    {
      ok: false,
      message: 'No image backend selected. Select an image backend to generate images.'
    }
  )
  setImageBackend({ provider: 'ollama', model: 'missing' })
  setOpenaiModelsCatalog([])
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/api/tags')) return response({ models: [] })
    return response({ version: '0.1.0' })
  }
  try {
    const result = await runGenerateImageTool('openai', { prompt: 'a lake' })
    assert.deepEqual(result, {
      ok: false,
      message:
        'The selected image backend is unavailable. Select an available image backend and try again.'
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects editing when the selected backend is Ollama', async () => {
  setImageBackend({ provider: 'ollama', model: 'flux' })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/api/tags')) {
      return response({
        models: [{ name: 'flux', details: { families: ['diffusion'] } }]
      })
    }
    return response({ version: '0.1.0' })
  }
  try {
    assert.deepEqual(
      await runEditImageTool('azure-openai', 'edit this', ['aW1hZ2U=']),
      {
        ok: false,
        message:
          'Image editing requires an OpenAI image model. Select an OpenAI image model and try again.'
      }
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
