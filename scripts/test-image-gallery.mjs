import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})

const gallery = await server.ssrLoadModule(
  new URL('../src/shared/image-gallery.ts', import.meta.url).pathname
)

after(() => server.close())

test('normalizes valid gallery records and rejects malformed records', () => {
  assert.deepEqual(
    gallery.normalizeImageGallery([
      {
        id: 'img-1',
        imageBase64: 'YWJj',
        mime: 'image/png',
        prompt: 'A blue house',
        provider: 'ollama',
        model: 'x/z-image-turbo',
        createdAt: '2026-09-28T00:00:00.000Z'
      },
      { id: 'missing-fields', provider: 'ollama' },
      {
        id: 'bad-provider',
        imageBase64: 'YWJj',
        mime: 'image/png',
        prompt: 'A prompt',
        provider: 'azure-openai',
        model: 'model',
        createdAt: '2026-09-28T00:00:00.000Z'
      },
      {
        id: 'empty-base64',
        imageBase64: '',
        mime: 'image/png',
        prompt: 'A prompt',
        provider: 'openai',
        model: 'model',
        createdAt: '2026-09-28T00:00:00.000Z'
      },
      {
        id: 'bad-date',
        imageBase64: 'YWJj',
        mime: 'image/png',
        prompt: 'A prompt',
        provider: 'openai',
        model: 'model',
        createdAt: 'not-a-date'
      },
      {
        id: 'non-iso-date',
        imageBase64: 'YWJj',
        mime: 'image/png',
        prompt: 'A prompt',
        provider: 'openai',
        model: 'model',
        createdAt: 'September 28, 2026'
      },
      {
        id: 'img-1',
        imageBase64: 'ZHVw',
        mime: 'image/jpeg',
        prompt: 'Duplicate',
        provider: 'openai',
        model: 'model',
        createdAt: '2026-09-29T00:00:00.000Z'
      }
    ]),
    [
      {
        id: 'img-1',
        imageBase64: 'YWJj',
        mime: 'image/png',
        prompt: 'A blue house',
        provider: 'ollama',
        model: 'x/z-image-turbo',
        createdAt: '2026-09-28T00:00:00.000Z'
      }
    ]
  )
  assert.deepEqual(gallery.normalizeImageGallery(undefined), [])
  assert.deepEqual(gallery.normalizeImageGallery({}), [])
})

test('accepts valid ISO timestamps with offsets', () => {
  assert.equal(
    gallery.normalizeImageGallery([
      {
        id: 'offset-date',
        imageBase64: 'YWJj',
        mime: 'image/png',
        prompt: 'A prompt',
        provider: 'openai',
        model: 'model',
        createdAt: '2026-09-28T00:00:00+05:30'
      }
    ]).length,
    1
  )
})

test('sorts multiple gallery records newest first without persistent store access', () => {
  const records = gallery.normalizeImageGallery([
    {
      id: 'older',
      imageBase64: 'YWJj',
      mime: 'image/png',
      prompt: 'Older',
      provider: 'ollama',
      model: 'model',
      createdAt: '2026-09-28T00:00:00.000Z'
    },
    {
      id: 'newest',
      imageBase64: 'YWJj',
      mime: 'image/png',
      prompt: 'Newest',
      provider: 'ollama',
      model: 'model',
      createdAt: '2026-09-30T00:00:00.000Z'
    },
    {
      id: 'middle',
      imageBase64: 'YWJj',
      mime: 'image/png',
      prompt: 'Middle',
      provider: 'ollama',
      model: 'model',
      createdAt: '2026-09-29T00:00:00.000Z'
    }
  ])

  assert.deepEqual(
    gallery.sortImageGalleryItems(records).map((item) => item.id),
    ['newest', 'middle', 'older']
  )
})
