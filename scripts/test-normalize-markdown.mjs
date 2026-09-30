import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
})
const { normalizeMarkdown } = await server.ssrLoadModule(
  new URL('../src/renderer/src/lib/normalizeMarkdown.ts', import.meta.url).pathname
)
after(() => server.close())

test('converts model bracket display math to $$ delimiters', () => {
  const input = '[ T={(x,y,z):1\\le x<y<z\\le 9}. ]'
  const out = normalizeMarkdown(input)
  assert.match(out, /^\$\$\nT=\{\(x,y,z\):1\\le x<y<z\\le 9\}\.\n\$\$$/)
})

test('converts boxed fractions in bracket math', () => {
  const input = '[ \\boxed{y=\\frac{123-22x}{4}} ]'
  const out = normalizeMarkdown(input)
  assert.match(out, /^\$\$\n\\boxed\{y=\\frac\{123-22x\}\{4\}\}\n\$\$$/)
})

test('leaves markdown links unchanged', () => {
  const input = '[docs](https://example.com)'
  assert.equal(normalizeMarkdown(input), input)
})

test('leaves link reference definitions unchanged', () => {
  const input = '[ref]: https://example.com'
  assert.equal(normalizeMarkdown(input), input)
})

test('does not rewrite bracket math inside fenced code', () => {
  const input = '```\n[ x=1 ]\n```'
  assert.equal(normalizeMarkdown(input), input)
})

test('inline bracket math breaks onto its own display block', () => {
  const input = 'The set is [ T={(x,y,z):1\\le x<y<z\\le 9}. ]'
  const out = normalizeMarkdown(input)
  assert.match(out, /^The set is \n\n\$\$/)
  assert.match(out, /T=\{\(x,y,z\):1\\le x<y<z\\le 9\}\.\n\$\$$/)
})

test('converts LaTeX \\( \\) and \\[ \\] delimiters to remark-math dollars', () => {
  assert.equal(normalizeMarkdown(String.raw`Alpha knows \(P=XYZ\).`), 'Alpha knows $P=XYZ$.')
  assert.equal(normalizeMarkdown(String.raw`Call this set \(W_1\).`), 'Call this set $W_1$.')
  const display = normalizeMarkdown(String.raw`\[
S=X+Y+Z.
\]`)
  assert.match(display, /^\$\$\nS=X\+Y\+Z\.\n\$\$$/)
  const tuple = normalizeMarkdown(String.raw`\[
(1,2,6),\;(1,3,4)
\]`)
  assert.match(tuple, /\$\$\n\(1,2,6\),\\;\(1,3,4\)\n\$\$/)
})

test('converts parenthetical LaTeX to inline math', () => {
  const input = String.raw`(\gcd(24,34)=2)`
  assert.equal(normalizeMarkdown(input), String.raw`$\gcd(24,34)=2$`)
})

test('leaves prose parentheses unchanged', () => {
  const input = '(Fig. 2)'
  assert.equal(normalizeMarkdown(input), input)
})

test('leaves Windows paths in parentheses unchanged', () => {
  const input = String.raw`(C:\test\path)`
  assert.equal(normalizeMarkdown(input), input)
})

test('does not rewrite parenthetical LaTeX inside fenced code', () => {
  const input = '```\n(\\foo)\n```'
  assert.equal(normalizeMarkdown(input), input)
})

test('does not double-wrap math already in dollar delimiters', () => {
  const input = String.raw`$(\gcd(1,2))$`
  assert.equal(normalizeMarkdown(input), input)
})

test('wraps bare array environment and fixes single-backslash row breaks', () => {
  const input = String.raw`\begin{array}{c|c|c|c} (X,Y,Z)&P&S&V\ \hline (1,3,8)&24&12&7\ (1,5,6)&30&12&5 \end{array}`
  const out = normalizeMarkdown(input)
  assert.match(out, /\$\$\n\\begin\{array\}/)
  assert.match(out, /V\\\\\n\\hline/)
  assert.match(out, /7\\\\\n\(1,5,6\)/)
  assert.match(out, /\\end\{array\}\n\$\$\n?$/)
})
