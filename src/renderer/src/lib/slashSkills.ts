import type { AgentSkill } from '../../../shared/types'

/** Slash token at the start of the composer: `/query` with no space yet. */
export function slashQuery(draft: string): string | null {
  if (!draft.startsWith('/')) return null
  const after = draft.slice(1)
  if (/\s/.test(after)) return null
  return after
}

export function filterSkills(skills: AgentSkill[], query: string): AgentSkill[] {
  const q = query.trim().toLowerCase()
  if (!q) return skills
  return skills.filter((s) => {
    const name = s.name.toLowerCase()
    const desc = s.description.toLowerCase()
    return name.includes(q) || desc.includes(q)
  })
}

export function parseInvokedSkill(
  text: string,
  skills: AgentSkill[]
): { skillName?: string; prompt: string } {
  const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/)
  if (!match) return { prompt: text }
  const token = match[1].toLowerCase()
  const skill = skills.find(
    (s) => s.name.toLowerCase() === token || s.id.toLowerCase() === token
  )
  if (!skill) return { prompt: text }
  const rest = (match[2] ?? '').trim()
  return {
    skillName: skill.name,
    prompt: rest || `Follow the ${skill.name} skill.`
  }
}
