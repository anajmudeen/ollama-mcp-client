import type { CatalogSkill } from '../shared/types'
import { installSkillFromMarkdown, parseSkillMarkdown } from './skills'

const GH_API =
  'https://api.github.com/repos/anthropics/skills/contents/skills'
const GH_RAW = 'https://raw.githubusercontent.com/anthropics/skills/main'
const GH_HTML = 'https://github.com/anthropics/skills/tree/main/skills'
const TTL_MS = 60 * 60 * 1000
const FETCH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'ollama-mcp-client'
}

let cached: { at: number; skills: CatalogSkill[] } | null = null
let inflight: Promise<CatalogSkill[]> | null = null

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(15000)
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch skills catalog: HTTP ${res.status}`)
  }
  return res.text()
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(15000)
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch skills catalog: HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

async function loadCatalog(): Promise<CatalogSkill[]> {
  const dirs = await fetchJson<Array<{ name: string; type: string; path: string }>>(
    GH_API
  )
  const folders = dirs.filter((d) => d.type === 'dir')
  const skills = await Promise.all(
    folders.map(async (folder): Promise<CatalogSkill | null> => {
      try {
        const raw = await fetchText(`${GH_RAW}/${folder.path}/SKILL.md`)
        const parsed = parseSkillMarkdown(raw)
        const name = parsed.name.trim() || folder.name
        return {
          id: folder.name,
          name,
          description: parsed.description.trim(),
          url: `${GH_HTML}/${folder.name}`,
          source: 'anthropics/skills'
        }
      } catch {
        return null
      }
    })
  )
  return skills
    .filter((s): s is CatalogSkill => s != null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listCatalogSkills(): Promise<CatalogSkill[]> {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return cached.skills
  }
  if (inflight) return inflight
  inflight = loadCatalog()
    .then((skills) => {
      cached = { at: Date.now(), skills }
      return skills
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export async function addCatalogSkill(id: string): Promise<void> {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '')
  if (!safe || safe !== id) {
    throw new Error('Invalid catalog skill id')
  }
  const raw = await fetchText(`${GH_RAW}/skills/${safe}/SKILL.md`)
  installSkillFromMarkdown(raw)
}
