import * as cheerio from 'cheerio'
import type {
  LibraryCapability,
  LibraryModelDetail,
  LibraryModelSummary,
  LibraryModelTag,
  LibrarySearchParams,
  LibrarySearchResult
} from '../shared/types'
import {
  getCachedLibrarySearch,
  getInflightLibrarySearch,
  setCachedLibrarySearch,
  setInflightLibrarySearch
} from './library-cache'

const CAPABILITIES: LibraryCapability[] = [
  'tools',
  'vision',
  'embedding',
  'thinking',
  'cloud'
]

const UA =
  'Mozilla/5.0 (compatible; ollama-mcp-client/0.1; +https://github.com/ollama/ollama)'

const OLLAMA_ORIGIN = 'https://ollama.com'

const DISK_SIZE_RE = /([\d.]+)\s*([KMGT]B)\b/i
const PARAM_SIZE_RE = /^(\d+(?:\.\d+)?)([bmk])$/i
const MOE_SIZE_RE = /^(\d+)x(\d+(?:\.\d+)?)b$/i

async function fetchHtml(
  url: string,
  extraHeaders: Record<string, string> = {}
): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      ...extraHeaders
    }
  })
  if (!res.ok) {
    throw new Error(`Library fetch failed: HTTP ${res.status} (${url})`)
  }
  return res.text()
}

async function fetchHtmlOrNull(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml'
    }
  })
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`Library fetch failed: HTTP ${res.status} (${url})`)
  }
  return res.text()
}

/** Keep `/` as path separators. Official models use /library/…; namespaced use /x/…. */
function modelPagePath(modelName: string): string {
  const path = modelName
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
  if (modelName.includes('/')) return `/${path}`
  return `/library/${path}`
}

function modelPageUrl(modelName: string): string {
  return `${OLLAMA_ORIGIN}${modelPagePath(modelName)}`
}

function parseCapabilities(text: string): LibraryCapability[] {
  const lower = text.toLowerCase()
  return CAPABILITIES.filter((c) => new RegExp(`\\b${c}\\b`, 'i').test(lower))
}

/** Normalize disk labels like "1.3 GB" → "1.3GB". */
export function parseDiskSizeLabel(text: string): string | undefined {
  const m = text.match(DISK_SIZE_RE)
  if (!m) return undefined
  return `${m[1]}${m[2].toUpperCase()}`
}

function diskSizeToBytes(label: string): number {
  const m = label.replace(/\s/g, '').match(/^([\d.]+)([KMGT]B)$/i)
  if (!m) return Number.POSITIVE_INFINITY
  const n = parseFloat(m[1])
  const unit = m[2].toUpperCase()
  const mul: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4
  }
  return n * (mul[unit] ?? 1)
}

function paramSizeToOrder(label: string): number {
  const moe = label.match(MOE_SIZE_RE)
  if (moe) return parseFloat(moe[1]) * parseFloat(moe[2]) * 1e9
  const m = label.match(PARAM_SIZE_RE)
  if (!m) return Number.POSITIVE_INFINITY
  const n = parseFloat(m[1])
  const u = m[2].toLowerCase()
  if (u === 'b') return n * 1e9
  if (u === 'm') return n * 1e6
  if (u === 'k') return n * 1e3
  return n
}

/** Prefer smallest disk size; otherwise smallest parameter-size badge. */
export function leastSizeLabel(options: {
  diskSizes?: string[]
  paramSizes?: string[]
}): string | undefined {
  const disks = (options.diskSizes ?? []).filter(Boolean)
  if (disks.length) {
    return [...disks].sort((a, b) => diskSizeToBytes(a) - diskSizeToBytes(b))[0]
  }
  const params = (options.paramSizes ?? []).filter(Boolean)
  if (params.length) {
    return [...params].sort((a, b) => paramSizeToOrder(a) - paramSizeToOrder(b))[0]
  }
  return undefined
}

function parseModelHref(href: string): string | null {
  if (!href) return null
  const path = href.split('?')[0] ?? href
  if (path.startsWith('/library/')) {
    const rest = path.slice('/library/'.length)
    const name = rest.split('/')[0]?.split(':')[0]?.trim()
    return name || null
  }
  // Community / namespaced models: /x/z-image-turbo, /jmorgan/z-image-turbo:latest
  const parts = path.split('/').filter(Boolean)
  const skip = new Set([
    'docs',
    'blog',
    'signin',
    'download',
    'pricing',
    'search',
    'models',
    'assets',
    'api'
  ])
  if (parts.length >= 2 && !skip.has(parts[0]) && parts[0] !== 'library') {
    const leaf = parts[1].split(':')[0]?.trim()
    if (!leaf) return null
    return `${parts[0]}/${leaf}`
  }
  return null
}

function parseSearchItem($: cheerio.CheerioAPI, li: any): LibraryModelSummary | null {
  const root = $(li)
  let link = root.find('a[href^="/library/"], a[href^="/x/"]').first()
  if (!link.length) {
    root.find('a[href]').each((_, el) => {
      if (link.length) return
      const href = $(el).attr('href') ?? ''
      if (parseModelHref(href)) link = $(el)
    })
  }
  const href = link.attr('href') ?? ''
  const name = parseModelHref(href)
  if (!name) return null

  const description =
    link.find('p').first().text().replace(/\s+/g, ' ').trim() ||
    $('meta[name=description]').attr('content')?.trim() ||
    ''

  const bodyText = link.text().replace(/\s+/g, ' ')
  const pullsMatch = bodyText.match(/([\d.]+[KMB]?)\s*Pulls/i)
  const tagsMatch = bodyText.match(/(\d+)\s*Tags/i)
  const updatedMatch = bodyText.match(/Updated\s+(.+?)(?:\s*$)/i)

  const sizes: string[] = []
  link.find('span').each((_, el) => {
    const t = $(el).text().trim().toLowerCase()
    if (PARAM_SIZE_RE.test(t) || MOE_SIZE_RE.test(t)) {
      sizes.push(t)
    }
  })
  const uniqueSizes = [...new Set(sizes)]

  return {
    name,
    description,
    capabilities: parseCapabilities(bodyText),
    pulls: pullsMatch?.[1],
    tagCount: tagsMatch?.[1],
    updated: updatedMatch?.[1]?.trim(),
    sizes: uniqueSizes.length ? uniqueSizes : undefined,
    minSize: leastSizeLabel({ paramSizes: uniqueSizes })
  }
}

export async function searchLibrary(
  params: LibrarySearchParams = {}
): Promise<LibrarySearchResult> {
  const cached = getCachedLibrarySearch(params)
  if (cached) return cached

  const pending = getInflightLibrarySearch(params)
  if (pending) return pending

  const promise = fetchLibrarySearch(params)
  setInflightLibrarySearch(params, promise)
  return promise
}

async function fetchLibrarySearch(
  params: LibrarySearchParams
): Promise<LibrarySearchResult> {
  const page = Math.max(1, params.page ?? 1)
  const hasQuery = Boolean(params.q?.trim())

  // Keyword search: Ollama often ranks namespaced hits (e.g. x/z-image-turbo)
  // on page 2+. Merge the first two pages on the initial request.
  if (hasQuery && page === 1) {
    const [first, second] = await Promise.all([
      fetchLibrarySearchPage({ ...params, page: 1 }),
      fetchLibrarySearchPage({ ...params, page: 2 })
    ])
    const seen = new Set<string>()
    const models: LibraryModelSummary[] = []
    for (const m of [...first.models, ...second.models]) {
      if (seen.has(m.name)) continue
      seen.add(m.name)
      models.push(m)
    }
    const result: LibrarySearchResult = {
      models,
      // Client should continue lazy-loading from page 3
      page: 2,
      hasMore: second.hasMore
    }
    setCachedLibrarySearch(params, result)
    return result
  }

  const result = await fetchLibrarySearchPage(params)
  setCachedLibrarySearch(params, result)
  return result
}

async function fetchLibrarySearchPage(
  params: LibrarySearchParams
): Promise<LibrarySearchResult> {
  const page = Math.max(1, params.page ?? 1)
  const url = new URL('https://ollama.com/search')
  if (params.q?.trim()) url.searchParams.set('q', params.q.trim())
  if (params.category) url.searchParams.set('c', params.category)
  if (params.order === 'newest') url.searchParams.set('o', 'newest')
  if (page > 1) url.searchParams.set('page', String(page))

  // ollama.com serves later pages only via HTMX; a normal GET with ?page=
  // returns page 1 again.
  const currentUrl = new URL('https://ollama.com/search')
  if (params.q?.trim()) currentUrl.searchParams.set('q', params.q.trim())
  if (params.category) currentUrl.searchParams.set('c', params.category)
  if (params.order === 'newest') currentUrl.searchParams.set('o', 'newest')

  const html = await fetchHtml(
    url.toString(),
    page > 1
      ? {
          'HX-Request': 'true',
          'HX-Current-URL': currentUrl.toString(),
          Accept: 'text/html'
        }
      : {}
  )
  const $ = cheerio.load(html)

  const models: LibraryModelSummary[] = []
  const seen = new Set<string>()
  $('li').each((_, li) => {
    const item = parseSearchItem($, li)
    if (!item || seen.has(item.name)) return
    seen.add(item.name)
    models.push(item)
  })

  const nextPage = page + 1
  const hasMore =
    models.length > 0 &&
    ($(`[hx-get*="page=${nextPage}"]`).length > 0 ||
      $(`a[href*="page=${nextPage}"]`).length > 0 ||
      html.includes(`page=${nextPage}`))

  const enriched = await enrichMinDiskSize(models)
  return { models: enriched, page, hasMore }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next
      next += 1
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () =>
      worker()
    )
  )
  return results
}

async function enrichMinDiskSize(
  models: LibraryModelSummary[]
): Promise<LibraryModelSummary[]> {
  if (models.length === 0) return models
  return mapPool(models, 6, async (model) => {
    try {
      const html = await fetchHtml(`${modelPageUrl(model.name)}/tags`)
      const $ = cheerio.load(html)
      const diskSizes: string[] = []
      const hrefPrefix = `${modelPagePath(model.name)}:`
      $(`a[href^="${hrefPrefix}"]`).each((_, el) => {
        const label = parseDiskSizeLabel($(el).text().replace(/\s+/g, ' '))
        if (label) diskSizes.push(label)
      })
      const minSize = leastSizeLabel({
        diskSizes,
        paramSizes: model.sizes
      })
      return minSize ? { ...model, minSize } : model
    } catch {
      return model
    }
  })
}

function tagNameFromHref(href: string): string | null {
  const raw = href.trim()
  if (!raw.includes(':')) return null
  if (raw.startsWith('/library/')) return raw.slice('/library/'.length)
  if (raw.startsWith('/')) return raw.slice(1)
  return raw
}

function parseTagRow(
  $: cheerio.CheerioAPI,
  el: any,
  modelName: string
): LibraryModelTag | null {
  const a = $(el)
  const href = a.attr('href') ?? ''
  const full = tagNameFromHref(href)
  if (!full?.includes(':')) return null
  const text = a.text().replace(/\s+/g, ' ').trim()
  if (text.length < full.length + 5 && a.children().length === 0) {
    return null
  }

  const size = parseDiskSizeLabel(text)
  const contextMatch = text.match(/([\d.]+[KMB]?)\s*context/i)
  const inputMatch = text.match(
    /(Text(?:\s*&\s*Image)?|Image|Text input)\b/i
  )
  const digestMatch = text.match(/\b([a-f0-9]{12})\b/i)
  const updatedMatch = text.match(
    /(\d+\s+(?:day|week|month|year)s?\s+ago|yesterday|today)/i
  )

  return {
    name: full.startsWith(modelName)
      ? full
      : `${modelName}:${full.split(':').pop()}`,
    size,
    context: contextMatch?.[1],
    input: inputMatch?.[1],
    digest: digestMatch?.[1],
    updated: updatedMatch?.[1]
  }
}

/** Prefer row-level parsing so desktop grid size columns are included. */
function parseTagRowsFromPage(
  $: cheerio.CheerioAPI,
  modelName: string
): LibraryModelTag[] {
  const tags: LibraryModelTag[] = []
  const seen = new Set<string>()
  const hrefPrefix = `${modelPagePath(modelName)}:`

  const pushTag = (tag: LibraryModelTag): void => {
    const existing = tags.find((t) => t.name === tag.name)
    if (existing) {
      if (!existing.size && tag.size) existing.size = tag.size
      if (!existing.context && tag.context) existing.context = tag.context
      if (!existing.input && tag.input) existing.input = tag.input
      return
    }
    if (seen.has(tag.name)) return
    seen.add(tag.name)
    tags.push(tag)
  }

  const rows = $('div.group.px-4.py-3')
  if (rows.length > 0) {
    rows.each((_, row) => {
      const $row = $(row)
      const link = $row.find(`a[href^="${hrefPrefix}"]`).first()
      const href = link.attr('href') ?? ''
      const full = tagNameFromHref(href)
      if (!full?.includes(':')) return

      const text = $row.text().replace(/\s+/g, ' ').trim()
      const size = parseDiskSizeLabel(text)
      const contextMatch = text.match(/([\d.]+[KMB]?)\s*context/i)
      const inputMatch = text.match(
        /(Text(?:\s*&\s*Image)?|Image|Text input)\b/i
      )
      const digestMatch = text.match(/\b([a-f0-9]{12})\b/i)
      const updatedMatch = text.match(
        /(\d+\s+(?:day|week|month|year)s?\s+ago|yesterday|today)/i
      )

      pushTag({
        name: full.startsWith(modelName)
          ? full
          : `${modelName}:${full.split(':').pop()}`,
        size,
        context: contextMatch?.[1],
        input: inputMatch?.[1],
        digest: digestMatch?.[1],
        updated: updatedMatch?.[1]
      })
    })
  }

  // Fallback: individual links (older markup)
  if (tags.length === 0) {
    $(`a[href^="${hrefPrefix}"]`).each((_, el) => {
      const tag = parseTagRow($, el, modelName)
      if (tag) pushTag(tag)
    })
  }

  return tags
}

/** Make relative /assets and /library links work outside ollama.com. */
export function absolutizeLibraryUrls(markdown: string): string {
  return markdown
    .replace(
      /(\]\()(\/(?:assets|library|x)\/[^)\s]+)(\))/g,
      (_m, a, path, b) => `${a}${OLLAMA_ORIGIN}${path}${b}`
    )
    .replace(
      /(src=["'])(\/(?:assets|library|x)\/[^"']+)(["'])/gi,
      (_m, a, path, b) => `${a}${OLLAMA_ORIGIN}${path}${b}`
    )
}

/** Prefer raw README.md from the editor textarea; fall back to prose text. */
export function extractReadmeMarkdown($: cheerio.CheerioAPI): string | undefined {
  const raw =
    $('#readme textarea#editor, textarea#editor, #readme textarea')
      .first()
      .val()
      ?.toString()
      .trim() ||
    $('#readme .prose, #readme .markdown-body')
      .first()
      .text()
      .replace(/\n{3,}/g, '\n\n')
      .trim() ||
    ''

  if (!raw) return undefined

  return absolutizeLibraryUrls(raw)
}

function libraryModelName(name: string): string {
  return name.replace(/^library\//, '').split(':')[0] ?? name
}

const readmeCache = new Map<string, string | null>()

export async function getLibraryReadme(name: string): Promise<string | undefined> {
  const candidate = libraryModelName(name)
  if (readmeCache.has(candidate)) {
    return readmeCache.get(candidate) ?? undefined
  }
  try {
    const pageHtml = await fetchHtmlOrNull(modelPageUrl(candidate))
    if (!pageHtml) {
      readmeCache.set(candidate, null)
      return undefined
    }
    const md = extractReadmeMarkdown(cheerio.load(pageHtml))
    readmeCache.set(candidate, md ?? null)
    return md
  } catch {
    readmeCache.set(candidate, null)
    return undefined
  }
}

export async function getLibraryModel(
  name: string
): Promise<LibraryModelDetail> {
  const modelName = libraryModelName(name)
  const baseUrl = modelPageUrl(modelName)
  const [pageHtml, tagsHtml] = await Promise.all([
    fetchHtml(baseUrl),
    fetchHtml(`${baseUrl}/tags`)
  ])

  const $page = cheerio.load(pageHtml)
  const description =
    $page('meta[name=description]').attr('content')?.trim() ||
    $page('h1')
      .first()
      .parent()
      .find('p')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim() ||
    ''

  const pageText = $page('main').text() || $page('body').text()
  const capabilities = parseCapabilities(pageText)
  const pullsMatch = pageText.match(/([\d.]+[KMB]?)\s*Pulls/i)

  const $tags = cheerio.load(tagsHtml)
  const tags = parseTagRowsFromPage($tags, modelName)

  if (tags.length === 0) {
    tags.push({ name: `${modelName}:latest` })
  }

  // Smallest disk size first in the detail list
  tags.sort((a, b) => {
    const aBytes = a.size ? diskSizeToBytes(a.size) : Number.POSITIVE_INFINITY
    const bBytes = b.size ? diskSizeToBytes(b.size) : Number.POSITIVE_INFINITY
    return aBytes - bBytes
  })

  const readme = extractReadmeMarkdown($page)
  if (readme) readmeCache.set(modelName, readme)

  return {
    name: modelName,
    description,
    capabilities,
    pulls: pullsMatch?.[1],
    tags,
    readme
  }
}
