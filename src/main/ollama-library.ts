import * as cheerio from 'cheerio'
import type {
  LibraryCapability,
  LibraryModelDetail,
  LibraryModelSummary,
  LibraryModelTag,
  LibrarySearchParams,
  LibrarySearchResult
} from '../shared/types'

const CAPABILITIES: LibraryCapability[] = [
  'tools',
  'vision',
  'embedding',
  'thinking',
  'cloud'
]

const UA =
  'Mozilla/5.0 (compatible; ollama-mcp-client/0.1; +https://github.com/ollama/ollama)'

const DISK_SIZE_RE = /([\d.]+)\s*([KMGT]B)\b/i
const PARAM_SIZE_RE = /^(\d+(?:\.\d+)?)([bmk])$/i
const MOE_SIZE_RE = /^(\d+)x(\d+(?:\.\d+)?)b$/i

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml'
    }
  })
  if (!res.ok) {
    throw new Error(`Library fetch failed: HTTP ${res.status} (${url})`)
  }
  return res.text()
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

function parseSearchItem($: cheerio.CheerioAPI, li: any): LibraryModelSummary | null {
  const root = $(li)
  const link = root.find('a[href^="/library/"]').first()
  const href = link.attr('href') ?? ''
  const name = href.replace(/^\/library\//, '').split('/')[0]?.trim()
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
  const page = Math.max(1, params.page ?? 1)
  const url = new URL('https://ollama.com/search')
  if (params.q?.trim()) url.searchParams.set('q', params.q.trim())
  if (params.category) url.searchParams.set('c', params.category)
  if (params.order === 'newest') url.searchParams.set('o', 'newest')
  if (page > 1) url.searchParams.set('page', String(page))

  const html = await fetchHtml(url.toString())
  const $ = cheerio.load(html)

  const models: LibraryModelSummary[] = []
  const seen = new Set<string>()
  $('li').each((_, li) => {
    if (!$(li).find('a[href^="/library/"]').length) return
    const item = parseSearchItem($, li)
    if (!item || seen.has(item.name)) return
    seen.add(item.name)
    models.push(item)
  })

  const hasMore =
    $(`a[href*="page=${page + 1}"]`).length > 0 ||
    $(`[hx-get*="page=${page + 1}"]`).length > 0 ||
    html.includes(`page=${page + 1}`)

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
      const html = await fetchHtml(
        `https://ollama.com/library/${encodeURIComponent(model.name)}/tags`
      )
      const $ = cheerio.load(html)
      const diskSizes: string[] = []
      $(`a[href^="/library/${model.name}:"]`).each((_, el) => {
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

function parseTagRow(
  $: cheerio.CheerioAPI,
  el: any,
  modelName: string
): LibraryModelTag | null {
  const a = $(el)
  const href = a.attr('href') ?? ''
  const full = href.replace(/^\/library\//, '').trim()
  if (!full.includes(':')) return null
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
      const link = $row
        .find(`a[href^="/library/${modelName}:"]`)
        .first()
      const href = link.attr('href') ?? ''
      const full = href.replace(/^\/library\//, '').trim()
      if (!full.includes(':')) return

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
    $(`a[href^="/library/${modelName}:"]`).each((_, el) => {
      const tag = parseTagRow($, el, modelName)
      if (tag) pushTag(tag)
    })
  }

  return tags
}

export async function getLibraryModel(
  name: string
): Promise<LibraryModelDetail> {
  const modelName = name.replace(/^library\//, '').split(':')[0]
  const [pageHtml, tagsHtml] = await Promise.all([
    fetchHtml(`https://ollama.com/library/${encodeURIComponent(modelName)}`),
    fetchHtml(
      `https://ollama.com/library/${encodeURIComponent(modelName)}/tags`
    )
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

  const readme =
    $page('#readme, .readme, article')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000) || undefined

  return {
    name: modelName,
    description,
    capabilities,
    pulls: pullsMatch?.[1],
    tags,
    readme
  }
}
