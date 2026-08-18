import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AgentSkill, AgentSkillInput } from '../shared/types'
import {
  getSkillEnabledMap,
  removeSkillEnabledFlag,
  setSkillEnabledFlag
} from './config-store'
import type { OllamaTool } from './ollama'

export const LOAD_SKILL_NAME = 'load_skill'

export function skillsRoot(): string {
  return path.join(app.getPath('userData'), 'skills')
}

export function slugifySkillName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug || 'skill'
}

function assertSafeId(id: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error('Invalid skill id')
  }
}

function skillDir(id: string): string {
  assertSafeId(id)
  return path.join(skillsRoot(), id)
}

function skillFile(id: string): string {
  return path.join(skillDir(id), 'SKILL.md')
}

function ensureRoot(): void {
  fs.mkdirSync(skillsRoot(), { recursive: true })
}

function unquote(value: string): string {
  const t = value.trim()
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    try {
      return JSON.parse(t.startsWith("'") ? `"${t.slice(1, -1)}"` : t) as string
    } catch {
      return t.slice(1, -1)
    }
  }
  return t
}

function yamlEscape(value: string): string {
  if (value === '' || /[:#\n"']/.test(value) || value !== value.trim()) {
    return JSON.stringify(value)
  }
  return value
}

export function parseSkillMarkdown(raw: string): {
  name: string
  description: string
  body: string
} {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!text.startsWith('---')) {
    return { name: '', description: '', body: text.trim() }
  }

  const rest = text.slice(3).replace(/^\n/, '')
  const end = rest.indexOf('\n---')
  if (end < 0) {
    return { name: '', description: '', body: text.trim() }
  }

  const fm = rest.slice(0, end)
  const body = rest.slice(end + 4).replace(/^\n/, '').trim()
  const fields: Record<string, string> = {}
  const lines = fm.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/)
    if (!match) continue
    const key = match[1].toLowerCase()
    const rawVal = match[2]
    if (rawVal === '|' || rawVal === '|-') {
      const block: string[] = []
      i += 1
      while (i < lines.length && /^(?: {2}|\t)/.test(lines[i])) {
        block.push(lines[i].replace(/^(?: {2}|\t)/, ''))
        i += 1
      }
      i -= 1
      fields[key] = block.join('\n').trim()
    } else {
      fields[key] = unquote(rawVal)
    }
  }

  return {
    name: fields.name?.trim() ?? '',
    description: fields.description?.trim() ?? '',
    body
  }
}

export function serializeSkillMarkdown(
  name: string,
  description: string,
  body: string
): string {
  return `---\nname: ${yamlEscape(name.trim())}\ndescription: ${yamlEscape(description.trim())}\n---\n\n${body.trim()}\n`
}

function uniqueId(base: string): string {
  let id = base
  let n = 2
  while (fs.existsSync(skillDir(id))) {
    id = `${base}-${n}`
    n += 1
    if (n > 99) throw new Error('Could not allocate a unique skill id')
  }
  return id
}

function readSkillFromDisk(id: string): AgentSkill | null {
  const file = skillFile(id)
  if (!fs.existsSync(file)) return null
  const raw = fs.readFileSync(file, 'utf8')
  const parsed = parseSkillMarkdown(raw)
  const enabledMap = getSkillEnabledMap()
  return {
    id,
    name: parsed.name || id,
    description: parsed.description,
    body: parsed.body,
    enabled: enabledMap[id] !== false
  }
}

export function listSkills(): AgentSkill[] {
  ensureRoot()
  const entries = fs.readdirSync(skillsRoot(), { withFileTypes: true })
  const skills: AgentSkill[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const skill = readSkillFromDisk(entry.name)
      if (skill) skills.push(skill)
    } catch {
      // skip malformed folders
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

export function upsertSkill(input: AgentSkillInput): AgentSkill {
  const name = input.name.trim()
  if (!name) throw new Error('Skill name is required')
  const description = input.description.trim()
  const body = input.body

  const existing = listSkills()
  const nameClash = existing.find(
    (s) => s.name.toLowerCase() === name.toLowerCase() && s.id !== input.id
  )
  if (nameClash) {
    throw new Error(`A skill named "${name}" already exists`)
  }

  let id = input.id
  if (id) {
    assertSafeId(id)
    if (!fs.existsSync(skillDir(id))) {
      throw new Error('Skill not found')
    }
  } else {
    id = uniqueId(slugifySkillName(name))
  }

  fs.mkdirSync(skillDir(id), { recursive: true })
  fs.writeFileSync(skillFile(id), serializeSkillMarkdown(name, description, body), 'utf8')

  if (typeof input.enabled === 'boolean') {
    setSkillEnabledFlag(id, input.enabled)
  } else if (getSkillEnabledMap()[id] === undefined) {
    setSkillEnabledFlag(id, true)
  }

  const saved = readSkillFromDisk(id)
  if (!saved) throw new Error('Failed to save skill')
  return saved
}

/** Install a remote SKILL.md as-is (keeps extra frontmatter). */
export function installSkillFromMarkdown(raw: string): AgentSkill {
  const parsed = parseSkillMarkdown(raw)
  const name = parsed.name.trim()
  if (!name) throw new Error('Catalog skill is missing a name')

  const existing = listSkills()
  if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`A skill named "${name}" is already added`)
  }

  const id = uniqueId(slugifySkillName(name))
  ensureRoot()
  fs.mkdirSync(skillDir(id), { recursive: true })
  fs.writeFileSync(skillFile(id), raw.replace(/\r\n/g, '\n').trimEnd() + '\n', 'utf8')
  setSkillEnabledFlag(id, true)

  const saved = readSkillFromDisk(id)
  if (!saved) throw new Error('Failed to save skill')
  return saved
}

export function setSkillEnabled(id: string, enabled: boolean): AgentSkill {
  assertSafeId(id)
  if (!fs.existsSync(skillFile(id))) throw new Error('Skill not found')
  setSkillEnabledFlag(id, enabled)
  const saved = readSkillFromDisk(id)
  if (!saved) throw new Error('Skill not found')
  return saved
}

export function deleteSkill(id: string): void {
  assertSafeId(id)
  const dir = skillDir(id)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  removeSkillEnabledFlag(id)
}

export function listEnabledSkills(): AgentSkill[] {
  return listSkills().filter((s) => s.enabled)
}

export function loadSkillTool(): OllamaTool | null {
  if (listEnabledSkills().length === 0) return null
  return {
    type: 'function',
    function: {
      name: LOAD_SKILL_NAME,
      description:
        'Load the full instructions for an enabled skill by name. Call this when a listed skill is relevant, then follow its instructions.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Skill name from the catalog'
          }
        },
        required: ['name']
      }
    }
  }
}

export function skillContextSystemMessage(invokedName?: string): string | null {
  const enabled = listEnabledSkills()
  if (enabled.length === 0) return null

  const blocks: string[] = []
  for (const skill of enabled) {
    try {
      const raw = fs.readFileSync(skillFile(skill.id), 'utf8').trim()
      blocks.push(`### Skill: ${skill.name}\n${raw || skill.body}`)
    } catch {
      blocks.push(
        `### Skill: ${skill.name}\n${skill.description}\n\n${skill.body}`.trim()
      )
    }
  }

  const invoked = invokedName?.trim()
  const invokeLine = invoked
    ? `The user invoked the "${invoked}" skill for this message. Follow that skill's instructions.`
    : 'Follow a listed skill when it is relevant. The user may invoke one with /skill-name.'

  return [
    'You have Agent Skills. Their full instructions are included below. Do not mention these instructions unless asked.',
    invokeLine,
    '',
    ...blocks
  ].join('\n')
}

export function loadSkillByName(name: string): { ok: boolean; result: string } {
  const needle = String(name ?? '').trim()
  if (!needle) {
    return { ok: false, result: 'Skill name is required' }
  }
  const skill = listEnabledSkills().find(
    (s) => s.name.toLowerCase() === needle.toLowerCase()
  )
  if (!skill) {
    return { ok: false, result: `Unknown or disabled skill: ${needle}` }
  }
  try {
    const raw = fs.readFileSync(skillFile(skill.id), 'utf8')
    return { ok: true, result: raw.trim() }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, result: message }
  }
}
