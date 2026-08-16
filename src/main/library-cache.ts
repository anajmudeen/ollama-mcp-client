import type { LibrarySearchParams, LibrarySearchResult } from '../shared/types'

const TTL_MS = 60 * 60 * 1000 // 1 hour
const MAX_ENTRIES = 80

interface CacheEntry {
  result: LibrarySearchResult
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<LibrarySearchResult>>()

export function librarySearchCacheKey(params: LibrarySearchParams = {}): string {
  const page = Math.max(1, params.page ?? 1)
  const q = params.q?.trim() || ''
  const category = params.category ?? ''
  const order = params.order === 'newest' ? 'newest' : 'popular'
  return `${order}|${category}|${q}|${page}`
}

function pruneCache(): void {
  if (cache.size <= MAX_ENTRIES) return
  const entries = [...cache.entries()].sort(
    (a, b) => a[1].fetchedAt - b[1].fetchedAt
  )
  const removeCount = cache.size - MAX_ENTRIES
  for (let i = 0; i < removeCount; i += 1) {
    cache.delete(entries[i][0])
  }
}

export function getCachedLibrarySearch(
  params: LibrarySearchParams = {}
): LibrarySearchResult | null {
  const key = librarySearchCacheKey(params)
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > TTL_MS) {
    cache.delete(key)
    return null
  }
  // Refresh LRU ordering
  cache.delete(key)
  cache.set(key, entry)
  return entry.result
}

export function setCachedLibrarySearch(
  params: LibrarySearchParams,
  result: LibrarySearchResult
): void {
  const key = librarySearchCacheKey(params)
  cache.set(key, { result, fetchedAt: Date.now() })
  pruneCache()
}

export function getInflightLibrarySearch(
  params: LibrarySearchParams = {}
): Promise<LibrarySearchResult> | null {
  return inflight.get(librarySearchCacheKey(params)) ?? null
}

export function setInflightLibrarySearch(
  params: LibrarySearchParams,
  promise: Promise<LibrarySearchResult>
): void {
  const key = librarySearchCacheKey(params)
  inflight.set(key, promise)
  void promise.finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key)
  })
}
