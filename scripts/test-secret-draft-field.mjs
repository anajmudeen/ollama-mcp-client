import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const mod = await server.ssrLoadModule(
  new URL('../src/shared/secret-draft-field.ts', import.meta.url).pathname
)
after(() => server.close())

test('Hide masks the draft; Show reveals plaintext', () => {
  assert.equal(mod.secretDraftInputType(false), 'password')
  assert.equal(mod.secretDraftInputType(true), 'text')
})

test('write-only secrets only persist non-empty drafts', () => {
  assert.equal(mod.nonEmptySecretDraft('  sk-abc  '), 'sk-abc')
  assert.equal(mod.nonEmptySecretDraft(''), null)
  assert.equal(mod.nonEmptySecretDraft('   '), null)
})

test('placeholder explains empty replacement draft', () => {
  assert.equal(mod.CONFIGURED_SECRET_PLACEHOLDER, 'Configured key is hidden')
})
