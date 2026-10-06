import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const {
  groupLocalModelsByFamily,
  partitionLibraryInstalledFirst,
  familyMatchesCapability
} = await server.ssrLoadModule(
  new URL('../src/renderer/src/lib/ollamaModelFamilies.ts', import.meta.url).pathname
)
after(() => server.close())

test('groupLocalModelsByFamily merges tags under base name', () => {
  const families = groupLocalModelsByFamily([
    { name: 'llama3:8b', size: 1, modifiedAt: '', tags: [] },
    { name: 'llama3:latest', size: 2, modifiedAt: '', tags: [] }
  ])
  assert.equal(families.length, 1)
  assert.equal(families[0].base, 'llama3')
  assert.equal(families[0].tags.length, 2)
})

test('partitionLibraryInstalledFirst puts installed names first', () => {
  const local = [{ name: 'phi3:mini', size: 1, modifiedAt: '', tags: [] }]
  const out = partitionLibraryInstalledFirst(
    [{ name: 'llama3' }, { name: 'phi3' }, { name: 'mistral' }],
    local
  )
  assert.deepEqual(out.map((m) => m.name), ['phi3', 'llama3', 'mistral'])
})

test('familyMatchesCapability checks tag capabilities', () => {
  const family = {
    base: 'x',
    tags: [{ name: 'x:1', size: 1, modifiedAt: '', tags: ['vision'], capabilities: [] }]
  }
  assert.equal(familyMatchesCapability(family, 'vision'), true)
  assert.equal(familyMatchesCapability(family, 'tools'), false)
})
