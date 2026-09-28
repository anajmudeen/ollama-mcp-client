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
const config = await server.ssrLoadModule(
  new URL('../src/main/config-store.ts', import.meta.url).pathname
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

test('adds, lists, and deletes gallery records', () => {
  const id = `test-${Date.now()}`
  config.deleteImageGalleryItem(id)
  const generated = config.addImageGalleryItem({
    imageBase64: 'ZGVm',
    mime: 'image/png',
    prompt: 'A generated test image',
    provider: 'openai',
    model: 'gpt-image-1'
  })
  assert.match(generated.id, /^[0-9a-f-]{36}$/)
  assert.match(generated.createdAt, /^\d{4}-\d{2}-\d{2}T/)

  const added = config.addImageGalleryItem({
    id,
    imageBase64: 'YWJj',
    mime: 'image/png',
    prompt: 'A test image',
    provider: 'ollama',
    model: 'flux'
  })
  assert.equal(added.id, id)
  assert.match(added.createdAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(config.listImageGallery()[0]?.id, id)
  assert.equal(config.deleteImageGalleryItem(id), true)
  assert.equal(config.deleteImageGalleryItem(id), false)
  assert.equal(config.deleteImageGalleryItem(generated.id), true)
})
