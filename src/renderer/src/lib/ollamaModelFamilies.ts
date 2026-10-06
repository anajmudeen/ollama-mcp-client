import type { LibraryCapability, LibraryModelSummary, OllamaModel } from '../../../shared/types'

export function localBaseName(name: string): string {
  return name.split(':')[0] ?? name
}

export interface LocalModelFamily {
  base: string
  tags: OllamaModel[]
}

export function groupLocalModelsByFamily(models: OllamaModel[]): LocalModelFamily[] {
  const byBase = new Map<string, OllamaModel[]>()
  for (const m of models) {
    const base = localBaseName(m.name)
    const list = byBase.get(base)
    if (list) list.push(m)
    else byBase.set(base, [m])
  }
  return [...byBase.entries()]
    .map(([base, tags]) => ({
      base,
      tags: [...tags].sort((a, b) => a.name.localeCompare(b.name))
    }))
    .sort((a, b) => a.base.localeCompare(b.base))
}

/** Match library cap or legacy installed cap string (e.g. image). */
export function familyMatchesCapability(
  family: LocalModelFamily,
  cap: LibraryCapability | string | null
): boolean {
  if (!cap) return true
  const capLower = cap.toLowerCase()
  return family.tags.some((m) => {
    const caps = (m.capabilities ?? []).map((c) => c.toLowerCase())
    const tags = (m.tags ?? []).map((t) => t.toLowerCase())
    return caps.includes(capLower) || tags.includes(capLower)
  })
}

export function isInstalledFamily(local: OllamaModel[], libraryName: string): boolean {
  return local.some((m) => localBaseName(m.name) === libraryName)
}

/** Stable: installed families first, then others; preserve relative order in each bucket. */
export function partitionLibraryInstalledFirst(
  list: LibraryModelSummary[],
  local: OllamaModel[]
): LibraryModelSummary[] {
  const installed: LibraryModelSummary[] = []
  const rest: LibraryModelSummary[] = []
  for (const m of list) {
    if (isInstalledFamily(local, m.name)) installed.push(m)
    else rest.push(m)
  }
  return [...installed, ...rest]
}
