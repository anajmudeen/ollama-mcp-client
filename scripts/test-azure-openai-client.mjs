import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const client = await server.ssrLoadModule(
  new URL('../src/main/azure-openai-client.ts', import.meta.url).pathname
)
after(() => server.close())

test('normalizes endpoint and encodes Azure URL components', () => {
  assert.equal(
    client.normalizeAzureEndpoint('https://example.openai.azure.com///'),
    'https://example.openai.azure.com'
  )
  assert.equal(
    client.buildAzureModelsUrl('https://example.openai.azure.com/', '2024-10/21'),
    'https://example.openai.azure.com/openai/models?api-version=2024-10%2F21'
  )
  assert.equal(
    client.buildAzureChatUrl(
      'https://example.openai.azure.com/',
      'gpt 4/deploy',
      '2024-10/21'
    ),
    'https://example.openai.azure.com/openai/deployments/gpt%204%2Fdeploy/chat/completions?api-version=2024-10%2F21'
  )
})

test('fetches and sorts Azure model catalog with capabilities', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return new Response(
      JSON.stringify({
        data: [
          { id: 'z-model', created: 2, capabilities: { chat_completion: true } },
          { id: 'a-model', created: 1, capabilities: { embeddings: true, chat_completion: false } }
        ]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }
  try {
    const models = await client.fetchAzureModels({
      endpoint: 'https://example.openai.azure.com///',
      apiVersion: '2024-10-21',
      apiKey: 'secret'
    })
    assert.deepEqual(models, [
      { id: 'a-model', capabilities: ['embeddings'], created: 1 },
      { id: 'z-model', capabilities: ['chat_completion'], created: 2 }
    ])
    assert.equal(requests[0].url, 'https://example.openai.azure.com/openai/models?api-version=2024-10-21')
    assert.deepEqual(requests[0].options.headers, {
      'api-key': 'secret',
      'Content-Type': 'application/json'
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('validates Azure credentials and exposes safe service errors', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'invalid deployment' } }), { status: 401 })
  try {
    const result = await client.validateAzureOpenai({
      endpoint: 'https://example.openai.azure.com',
      apiVersion: '2024-10-21',
      apiKey: 'secret'
    })
    assert.deepEqual(result, { ok: false, error: 'invalid deployment' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('sends Azure chat requests with api-key and no model field', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'hello', reasoning_content: 'think', tool_calls: [{ index: 0, id: 'call-1', function: { name: 'lookup', arguments: '{"q":' } }] } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] } }] })}\n\n` +
        `data: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })}\n\n` +
        'data: [DONE]\n\n',
      { status: 200 }
    )
  }
  try {
    const chunks = []
    const result = await client.azureOpenAiChatStream({
      endpoint: 'https://example.openai.azure.com/',
      deployment: 'gpt 4/deploy',
      apiVersion: '2024-10/21',
      apiKey: 'secret',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ function: { name: 'lookup', description: 'find', parameters: {} } }],
      onChunk: (chunk) => chunks.push(chunk)
    })
    assert.equal(request.url, 'https://example.openai.azure.com/openai/deployments/gpt%204%2Fdeploy/chat/completions?api-version=2024-10%2F21')
    assert.equal(request.options.headers.Authorization, undefined)
    assert.equal(request.options.headers['api-key'], 'secret')
    const body = JSON.parse(request.options.body)
    assert.equal(body.model, undefined)
    assert.equal(body.stream, true)
    assert.equal(body.tools[0].function.name, 'lookup')
    assert.equal(result.content, 'hello')
    assert.deepEqual(result.toolCalls, [{ name: 'lookup', arguments: { q: 'x' } }])
    assert.deepEqual(result.usage, {
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
      cachedPromptTokens: 0,
      reasoningTokens: 0
    })
    assert.equal(chunks[0].message.content, 'hello')
    assert.equal(chunks[1].message.thinking, 'think')
    assert.equal(chunks[2].message.tool_calls[0].function.name, 'lookup')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('supports non-streaming Azure chat with abort signal', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'title' } }] }), {
      status: 200
    })
  }
  try {
    const controller = new AbortController()
    assert.equal(
      await client.azureOpenAiChatOnce({
        endpoint: 'https://example.openai.azure.com',
        deployment: 'title',
        apiVersion: '2024-10-21',
        apiKey: 'secret',
        messages: [{ role: 'user', content: 'summarize' }],
        signal: controller.signal
      }),
      'title'
    )
    assert.equal(request.options.signal, controller.signal)
    assert.equal(JSON.parse(request.options.body).stream, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
