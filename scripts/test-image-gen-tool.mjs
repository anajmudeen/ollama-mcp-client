import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})

const {
  EDIT_IMAGE_NAME,
  GENERATE_IMAGE_NAME,
  editImageToolDefinition,
  generateImageToolDefinition,
  runEditImageTool,
  runGenerateImageTool,
  generateImageForBackend,
  shouldOfferGenerateImageTool
} =
  await server.ssrLoadModule(
    new URL('../src/main/image-gen-tool.ts', import.meta.url).pathname
  )
const {
  setDefaultImageModel,
  setLlmProvider,
  setImageBackend,
  setOpenaiEnabled,
  setOpenaiApiKey,
  setOpenaiValidationOk,
  setOpenaiModelEnabled,
  setOpenaiModelsCatalog,
  setSelectedModelForProvider,
  setAzureOpenaiEnabled,
  setAzureOpenaiApiKey,
  setAzureOpenaiEndpoint,
  setAzureOpenaiValidationOk,
  getAzureOpenaiDeployments,
  removeAzureOpenaiDeployment
} = await server.ssrLoadModule(
  new URL('../src/main/config-store.ts', import.meta.url).pathname
)
after(() => server.close())

beforeEach(() => {
  setImageBackend(null)
  setDefaultImageModel(null)
  setLlmProvider('ollama')
  setSelectedModelForProvider('ollama', null)
  setSelectedModelForProvider('openai', null)
  setSelectedModelForProvider('azure-openai', null)
  setOpenaiEnabled(true)
  setOpenaiApiKey(null)
  setOpenaiValidationOk(true)
  setOpenaiModelsCatalog([])
  setAzureOpenaiEnabled(false)
  setAzureOpenaiApiKey(null)
  setAzureOpenaiEndpoint(null)
  setAzureOpenaiValidationOk(false, 'test reset')
  for (const deployment of getAzureOpenaiDeployments()) {
    removeAzureOpenaiDeployment(deployment.name)
  }
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

test('defines distinct prompt-only generation and editing tools', () => {
  const generate = generateImageToolDefinition().function
  const edit = editImageToolDefinition().function

  assert.equal(GENERATE_IMAGE_NAME, 'generate_image')
  assert.equal(EDIT_IMAGE_NAME, 'edit_image')
  assert.equal(generate.name, GENERATE_IMAGE_NAME)
  assert.equal(edit.name, EDIT_IMAGE_NAME)
  for (const definition of [generate, edit]) {
    assert.deepEqual(definition.parameters.required, ['prompt'])
    assert.deepEqual(Object.keys(definition.parameters.properties), ['prompt'])
  }
  assert.match(generate.description, /generate/i)
  assert.match(generate.description, /text prompt/i)
  assert.match(edit.description, /edit/i)
  assert.match(edit.description, /source image/i)
})

test('routes selected source images to OpenAI editing', async () => {
  setOpenaiApiKey('test-key')
  setOpenaiModelsCatalog([{ id: 'gpt-image-1', name: 'gpt-image-1' }])
  setOpenaiModelEnabled('gpt-image-1', true)
  setImageBackend({ provider: 'openai', model: 'gpt-image-1' })
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (...args) => {
    calls.push(args)
    if (String(args[0]).endsWith('/api/tags')) return response({}, 500)
    return response({ data: [{ b64_json: 'edited-image' }] })
  }

  try {
    const result = await runEditImageTool('openai', 'remove the background', [
      'Zmlyc3Q=',
      'c2Vjb25k',
      'Zmlyc3Q='
    ])
    assert.deepEqual(result, {
      ok: true,
      model: 'gpt-image-1',
      imageBase64: 'edited-image',
      message: 'Edited image with gpt-image-1 via openai'
    })
    const request = calls.at(-1)[1]
    assert.equal(request.body.get('model'), 'gpt-image-1')
    assert.equal(request.body.get('prompt'), 'remove the background')
    const images = request.body.getAll('image')
    assert.equal(images.length, 2)
    assert.deepEqual(
      await Promise.all(
        images.map((image) =>
          image.arrayBuffer().then((bytes) => Buffer.from(bytes).toString())
        )
      ),
      ['first', 'second']
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects invalid image arguments with a clear failure', async () => {
  for (const images of [null, 'not-an-array', ['']]) {
    const result = await runEditImageTool('openai', 'edit this', images)
    assert.deepEqual(result, {
      ok: false,
      message: 'Source images must be non-empty strings'
    })
  }
})

test('rejects an unavailable selected backend without provider fallback', async () => {
  setOpenaiModelsCatalog([{ id: 'gpt-image-1', name: 'gpt-image-1' }])
  setOpenaiModelEnabled('gpt-image-1', true)
  setImageBackend({ provider: 'ollama', model: 'missing-image-model' })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (...args) => {
    const url = String(args[0])
    if (url.endsWith('/api/tags')) {
      return response({
        models: [{ name: 'flux', details: { families: ['diffusion'] } }]
      })
    }
    if (url.endsWith('/api/version')) return response({ version: '0.1.0' })
    if (url.endsWith('/images/generations')) {
      return response({ data: [{ b64_json: 'openai-image' }] })
    }
    if (url.endsWith('/api/generate')) {
      return response({ image: Buffer.alloc(1024, 7).toString('base64') })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }

  try {
    for (const provider of ['openai', 'ollama', 'azure-openai']) {
      const result = await runGenerateImageTool(provider, { prompt: 'a test image' })
      assert.deepEqual(result, {
        ok: false,
        message:
          'The selected image backend is unavailable. Select an available image backend and try again.'
      })
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('offers the tool for any chat provider when Ollama is selected', async () => {
  setOpenaiModelsCatalog([])
  setImageBackend({ provider: 'ollama', model: 'flux' })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (...args) => {
    if (String(args[0]).endsWith('/api/tags')) {
      return response({
        models: [{ name: 'flux', details: { families: ['diffusion'] } }]
      })
    }
    return response({ version: '0.1.0' })
  }

  try {
    assert.equal(await shouldOfferGenerateImageTool('openai', 'gpt-4.1-mini'), true)
    assert.equal(await shouldOfferGenerateImageTool('ollama', 'llama3.2'), true)
    assert.equal(await shouldOfferGenerateImageTool('azure-openai', 'gpt-4.1-mini'), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects OpenAI image-tool calls when only Ollama image backend exists', async () => {
  setOpenaiModelsCatalog([])
  setImageBackend({ provider: 'ollama', model: 'flux' })
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (...args) => {
    calls.push(args)
    const url = String(args[0])
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
    const result = await runGenerateImageTool('openai', { prompt: 'a test image' })
    assert.equal(result.ok, true)
    assert.equal(result.model, 'flux')
    assert.equal(calls.some((call) => String(call[0]).endsWith('/api/generate')), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('returns a clear failure when no image backend is selected', async () => {
  // Clear the migration-only legacy value so null means no selected backend.
  setDefaultImageModel(null)
  setImageBackend(null)
  const generated = await runGenerateImageTool('azure-openai', { prompt: 'a test image' })
  assert.deepEqual(generated, {
    ok: false,
    message: 'No image backend selected. Select an image backend to generate images.'
  })
})

test('rejects blank prompts for explicit image generation', async () => {
  const result = await generateImageForBackend({
    provider: 'ollama',
    model: 'flux',
    prompt: '   '
  })
  assert.deepEqual(result, {
    ok: false,
    message: 'Prompt must not be blank'
  })
})

test('rejects invalid providers and unavailable models', async () => {
  const invalidProvider = await generateImageForBackend({
    provider: 'azure-openai',
    model: 'flux',
    prompt: 'a test image'
  })
  assert.deepEqual(invalidProvider, {
    ok: false,
    message: 'Invalid image provider'
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (...args) => {
    if (String(args[0]).endsWith('/api/version')) return response({ version: '0.1.0' })
    if (String(args[0]).endsWith('/api/tags')) {
      return response({ models: [{ name: 'flux', details: { families: ['diffusion'] } }] })
    }
    throw new Error(`Unexpected fetch: ${String(args[0])}`)
  }
  try {
    const result = await generateImageForBackend({
      provider: 'ollama',
      model: 'missing',
      prompt: 'a test image'
    })
    assert.deepEqual(result, {
      ok: false,
      message: 'Selected image model is unavailable'
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('routes explicit Ollama and OpenAI image generation selections', async () => {
  setOpenaiApiKey('test-key')
  setOpenaiModelsCatalog([{ id: 'gpt-image-1', name: 'gpt-image-1' }])
  setOpenaiModelEnabled('gpt-image-1', true)
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (...args) => {
    calls.push(args)
    const url = String(args[0])
    if (url.endsWith('/api/version')) return response({ version: '0.1.0' })
    if (url.endsWith('/api/tags')) {
      return response({ models: [{ name: 'flux', details: { families: ['diffusion'] } }] })
    }
    if (url.endsWith('/api/generate')) {
      return response({ image: Buffer.alloc(1024, 7).toString('base64') })
    }
    if (url.endsWith('/images/generations')) {
      return response({ data: [{ b64_json: 'openai-image' }] })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }
  try {
    const ollama = await generateImageForBackend({
      provider: 'ollama',
      model: 'flux',
      prompt: 'ollama image'
    })
    assert.deepEqual(ollama, {
      ok: true,
      provider: 'ollama',
      model: 'flux',
      imageBase64: Buffer.alloc(1024, 7).toString('base64'),
      mime: 'image/png'
    })
    const openai = await generateImageForBackend({
      provider: 'openai',
      model: 'gpt-image-1',
      prompt: 'openai image'
    })
    assert.deepEqual(openai, {
      ok: true,
      provider: 'openai',
      model: 'gpt-image-1',
      imageBase64: 'openai-image',
      mime: 'image/png'
    })
    assert.equal(calls.some((call) => String(call[0]).endsWith('/api/generate')), true)
    assert.equal(calls.some((call) => String(call[0]).endsWith('/images/generations')), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('offers the tool to Ollama when Ollama is unavailable but OpenAI is the image backend', async () => {
  setImageBackend({ provider: 'openai', model: 'gpt-image-1' })
  setOpenaiApiKey('test-key')
  setOpenaiModelsCatalog([{ id: 'gpt-image-1', name: 'gpt-image-1' }])
  setOpenaiModelEnabled('gpt-image-1', true)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (...args) => {
    if (String(args[0]).endsWith('/api/tags')) {
      throw new Error('Ollama unavailable')
    }
    return response({ data: [{ b64_json: 'unused' }] })
  }

  try {
    assert.equal(await shouldOfferGenerateImageTool('ollama', 'llama3.2'), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects malformed base64 before attempting OpenAI editing', async () => {
  setOpenaiApiKey('test-key')
  setOpenaiModelsCatalog([{ id: 'gpt-image-1', name: 'gpt-image-1' }])
  setOpenaiModelEnabled('gpt-image-1', true)
  setImageBackend({ provider: 'openai', model: 'gpt-image-1' })
  const originalFetch = globalThis.fetch
  let fetchCalled = false
  globalThis.fetch = async (...args) => {
    fetchCalled = String(args[0]).endsWith('/images/edits')
    return response({ data: [{ b64_json: 'unexpected' }] })
  }

  try {
    const result = await runEditImageTool('openai', 'edit this', ['not-valid-base64'])
    assert.equal(result.ok, false)
    assert.match(result.message, /valid base64/)
    assert.equal(fetchCalled, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects image editing on Ollama without text generation', async () => {
  setOpenaiModelsCatalog([])
  setImageBackend({ provider: 'ollama', model: 'flux' })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (...args) => {
    if (String(args[0]).endsWith('/api/tags')) {
      return response({
        models: [{ name: 'flux', details: { families: ['diffusion'] } }]
      })
    }
    return response({ version: '0.1.0' })
  }

  try {
    const result = await runEditImageTool('ollama', 'edit this', ['base64-image'])
    assert.deepEqual(result, {
      ok: false,
      message:
        'Image editing requires an OpenAI image model. Select an OpenAI image model and try again.'
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('keeps generation text-only even when extra images are supplied internally', async () => {
  setOpenaiApiKey('test-key')
  setOpenaiModelsCatalog([{ id: 'dall-e-3', name: 'dall-e-3' }])
  setOpenaiModelEnabled('dall-e-3', true)
  setImageBackend({ provider: 'openai', model: 'dall-e-3' })
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (...args) => {
    calls.push(args)
    return response({ data: [{ b64_json: 'generated-image' }] })
  }

  try {
    const result = await runGenerateImageTool('openai', {
      prompt: 'a red kite',
      images: ['aW1hZ2U=']
    })
    assert.equal(result.ok, true)
    assert.ok(
      calls.some((call) => String(call[0]).endsWith('/images/generations'))
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('preserves text-only OpenAI result metadata and routing', async () => {
  setOpenaiApiKey('test-key')
  setOpenaiModelsCatalog([{ id: 'dall-e-3', name: 'dall-e-3' }])
  setOpenaiModelEnabled('dall-e-3', true)
  setImageBackend({ provider: 'openai', model: 'dall-e-3' })
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (...args) => {
    calls.push(args)
    return response({ data: [{ b64_json: 'generated-openai-image' }] })
  }

  try {
    const result = await runGenerateImageTool('openai', {
      prompt: 'a red kite'
    })
    assert.deepEqual(result, {
      ok: true,
      model: 'dall-e-3',
      imageBase64: 'generated-openai-image',
      message: 'Generated image with dall-e-3 via openai'
    })
    const generationCall = calls.find((call) =>
      String(call[0]).endsWith('/images/generations')
    )
    assert.ok(generationCall)
    assert.equal(
      calls.some((call) => String(call[0]).endsWith('/images/edits')),
      false
    )
    const request = JSON.parse(generationCall[1].body)
    assert.deepEqual(request, {
      model: 'dall-e-3',
      prompt: 'a red kite',
      n: 1,
      response_format: 'b64_json'
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('preserves text-only Ollama result metadata and routing', async () => {
  setOpenaiModelsCatalog([])
  setImageBackend({ provider: 'ollama', model: 'flux' })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (...args) => {
    const url = String(args[0])
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
    const result = await runGenerateImageTool('ollama', {
      prompt: 'a blue kite'
    })
    assert.deepEqual(result, {
      ok: true,
      model: 'flux',
      imageBase64: Buffer.alloc(1024, 7).toString('base64'),
      message: 'Generated image with flux via ollama'
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
