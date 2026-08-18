import type { CatalogSkill } from '../shared/types'
import {
  SKILL_MAX_FILES,
  installSkillFromFiles,
  parseSkillMarkdown,
  type SkillTreeFile
} from './skills'

const GH_API =
  'https://api.github.com/repos/anthropics/skills/contents/skills'
const GH_RAW = 'https://raw.githubusercontent.com/anthropics/skills/main'
const GH_HTML = 'https://github.com/anthropics/skills/tree/main/skills'
const TTL_MS = 60 * 60 * 1000
const FETCH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'ollama-mcp-client'
}

const SKIP_DIR_NAMES = new Set(['.git', 'node_modules'])
const SKIP_FILE_NAMES = new Set(['.DS_Store'])

let cached: { at: number; skills: CatalogSkill[] } | null = null
let inflight: Promise<CatalogSkill[]> | null = null

type GhContent = {
  name: string
  path: string
  type: string
  download_url: string | null
}

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

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(15000)
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch skills catalog: HTTP ${res.status}`)
  }
  return Buffer.from(await res.arrayBuffer())
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

function relativeFromSkill(skillId: string, repoPath: string): string {
  const prefix = `skills/${skillId}/`
  if (!repoPath.startsWith(prefix)) {
    throw new Error('Invalid catalog skill path')
  }
  return repoPath.slice(prefix.length)
}

async function collectCatalogSkillFiles(skillId: string): Promise<SkillTreeFile[]> {
  const files: SkillTreeFile[] = []

  const walk = async (apiUrl: string): Promise<void> => {
    const entries = await fetchJson<GhContent[]>(apiUrl)
    for (const entry of entries) {
      if (entry.type === 'dir') {
        if (SKIP_DIR_NAMES.has(entry.name)) continue
        await walk(
          `https://api.github.com/repos/anthropics/skills/contents/${entry.path}`
        )
        continue
      }
      if (entry.type !== 'file') continue
      if (SKIP_FILE_NAMES.has(entry.name)) continue
      if (files.length >= SKILL_MAX_FILES) {
        throw new Error(`Skill has more than ${SKILL_MAX_FILES} files`)
      }
      const rel = relativeFromSkill(skillId, entry.path)
      const url = entry.download_url ?? `${GH_RAW}/${entry.path}`
      const data = await fetchBuffer(url)
      files.push({ relativePath: rel, data })
    }
  }

  await walk(`${GH_API}/${skillId}`)
  return files
}

export async function addCatalogSkill(id: string): Promise<void> {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '')
  if (!safe || safe !== id) {
    throw new Error('Invalid catalog skill id')
  }
  const files = await collectCatalogSkillFiles(safe)
  installSkillFromFiles(files)
}
