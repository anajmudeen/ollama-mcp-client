import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, beforeEach } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})

const mod = await server.ssrLoadModule(
  new URL('../src/main/session-images.ts', import.meta.url).pathname
)

const shared = await server.ssrLoadModule(
  new URL('../src/shared/types.ts', import.meta.url).pathname
)

after(() => server.close())

// 1x1 PNG
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const DATA_URL = `data:image/png;base64,${PNG_B64}`

let root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'session-images-'))
  mod.setSessionImagesRootForTests(root)
})

after(() => {
  mod.setSessionImagesRootForTests(null)
  if (root && existsSync(root)) rmSync(root, { recursive: true, force: true })
})

test('externalize replaces data URLs with session-img refs and writes files', () => {
  const sessionId = '11111111-1111-4111-8111-111111111111'
  const uiMessages = [
    {
      kind: 'assistant',
      id: 'a1',
      content: 'here',
      createdAt: '2026-09-29T00:00:00.000Z',
      images: [DATA_URL]
    }
  ]
  const { messages, changed } = mod.externalizeUiMessageImages(sessionId, uiMessages)
  assert.equal(changed, true)
  assert.equal(messages[0].images.length, 1)
  assert.match(messages[0].images[0], /^session-img:\/\/[0-9a-f-]{36}$/i)
  const files = readdirSync(root)
  assert.equal(files.length, 1)
  assert.ok(files[0].startsWith(`${sessionId}_`))
  assert.ok(files[0].endsWith('.png'))
})

test('second externalize pass is a no-op', () => {
  const sessionId = '22222222-2222-4222-8222-222222222222'
  const first = mod.externalizeUiMessageImages(sessionId, [
    {
      kind: 'assistant',
      id: 'a1',
      content: '',
      createdAt: '2026-09-29T00:00:00.000Z',
      images: [DATA_URL]
    }
  ])
  const second = mod.externalizeUiMessageImages(sessionId, first.messages)
  assert.equal(second.changed, false)
  assert.equal(second.messages, first.messages)
  assert.equal(readdirSync(root).length, 1)
})

test('deleteSessionImages removes files for that session only', () => {
  const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  mod.externalizeUiMessageImages(a, [
    {
      kind: 'user',
      id: 'u1',
      content: '',
      createdAt: '2026-09-29T00:00:00.000Z',
      images: [DATA_URL]
    }
  ])
  mod.externalizeUiMessageImages(b, [
    {
      kind: 'user',
      id: 'u2',
      content: '',
      createdAt: '2026-09-29T00:00:00.000Z',
      images: [DATA_URL]
    }
  ])
  assert.equal(readdirSync(root).length, 2)
  mod.deleteSessionImages(a)
  const left = readdirSync(root)
  assert.equal(left.length, 1)
  assert.ok(left[0].startsWith(`${b}_`))
})

test('uiMessagesHaveInlineImages detects data URLs but not refs', () => {
  assert.equal(
    mod.uiMessagesHaveInlineImages([
      {
        kind: 'assistant',
        id: 'a1',
        content: '',
        createdAt: '2026-09-29T00:00:00.000Z',
        images: [DATA_URL]
      }
    ]),
    true
  )
  assert.equal(
    mod.uiMessagesHaveInlineImages([
      {
        kind: 'assistant',
        id: 'a1',
        content: '',
        createdAt: '2026-09-29T00:00:00.000Z',
        images: ['session-img://33333333-3333-4333-8333-333333333333']
      }
    ]),
    false
  )
})

test('toSessionSummary omits uiMessages and history', async () => {
  const summaryMod = await server.ssrLoadModule(
    new URL('../src/shared/session-summary.ts', import.meta.url).pathname
  )
  const summary = summaryMod.toSessionSummary({
    id: 's1',
    title: 'Hi',
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
    uiMessages: [
      { kind: 'user', id: 'u', content: 'x', createdAt: '2026-09-29T00:00:00.000Z' }
    ],
    history: [{ role: 'user', content: 'x' }],
    origin: 'desktop'
  })
  assert.deepEqual(summary, {
    id: 's1',
    title: 'Hi',
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
    origin: 'desktop'
  })
  assert.equal('uiMessages' in summary, false)
  assert.equal('history' in summary, false)
})

void shared
