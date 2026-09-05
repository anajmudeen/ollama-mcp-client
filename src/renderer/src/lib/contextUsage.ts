import type { AgentSkill, McpToolInfo, UiMessage } from '../../../shared/types'
import { estimateTokensFromChars, estimateTokensFromText } from '../../../shared/contextUsage'
import type { ChatAttachment } from './attachments'

export {
  estimateTokensFromChars,
  estimateTokensFromText,
  estimateChatMessagesTokens,
  formatTokenCount
} from '../../../shared/contextUsage'

export function estimateMessageTokens(messages: UiMessage[]): number {
  let chars = 0
  for (const m of messages) {
    if (
      m.kind === 'user' ||
      m.kind === 'assistant' ||
      m.kind === 'thinking' ||
      m.kind === 'error'
    ) {
      chars += m.content.length
    } else if (m.kind === 'tool') {
      chars += m.name.length
      chars += JSON.stringify(m.arguments).length
      chars += m.result?.length ?? 0
    }
    // notice: negligible / not sent to the model
  }
  return estimateTokensFromChars(chars)
}

export function estimateToolSchemaTokens(tools: McpToolInfo[]): number {
  if (tools.length === 0) return 0
  let chars = 0
  for (const t of tools) {
    chars += t.prefixedName.length
    chars += t.description?.length ?? 0
    if (t.inputSchema) chars += JSON.stringify(t.inputSchema).length
  }
  return estimateTokensFromChars(chars)
}

/** Matches `loadSkillTool()` overhead sent with enabled skills in the agent. */
function estimateLoadSkillToolTokens(): number {
  const tool = {
    type: 'function',
    function: {
      name: 'load_skill',
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
  return estimateTokensFromChars(JSON.stringify(tool).length)
}

export function estimateAgentToolTokens(
  tools: McpToolInfo[],
  skillsEnabled: boolean
): number {
  const mcp = estimateToolSchemaTokens(tools)
  if (!skillsEnabled) return mcp
  return mcp + estimateLoadSkillToolTokens()
}

export function buildSkillsContextText(skills: AgentSkill[]): string {
  return skills
    .map((s) => `### Skill: ${s.name}\n${s.description}\n\n${s.body}`.trim())
    .join('\n\n')
}

export function estimateSummarizedTokens(messages: UiMessage[]): number {
  return messages.reduce((n, m) => {
    if (m.kind !== 'notice' || !m.summary) return n
    return n + estimateTokensFromText(m.summary)
  }, 0)
}

/** Live estimate of tokens that will be sent on the next prompt. */
export function estimateLivePromptTokens(options: {
  systemPrompt?: string
  skills: AgentSkill[]
  tools: McpToolInfo[]
  messages: UiMessage[]
  draft: string
  attachments: ChatAttachment[]
}): number {
  const skillsText = buildSkillsContextText(options.skills)
  return (
    estimateTokensFromText(options.systemPrompt ?? '') +
    estimateTokensFromText(skillsText) +
    estimateAgentToolTokens(options.tools, options.skills.length > 0) +
    estimateSummarizedTokens(options.messages) +
    estimateMessageTokens(options.messages) +
    estimateDraftTokens(options.draft, options.attachments)
  )
}

export function estimateDraftTokens(
  draft: string,
  attachments: ChatAttachment[]
): number {
  let chars = draft.length
  for (const file of attachments) {
    if (file.textContent) chars += file.textContent.length
    else if (file.imageBase64) chars += Math.ceil(file.imageBase64.length / 8)
  }
  return estimateTokensFromChars(chars)
}

export function contextUsageColor(pct: number): string {
  if (pct >= 90) return '#f0a0a0'
  if (pct >= 70) return '#e0c070'
  return '#8b9aab'
}

export interface ContextSlice {
  id: 'system' | 'skills' | 'tools' | 'summarized' | 'conversation' | 'draft'
  label: string
  tokens: number
  color: string
}

const SLICE_META: Record<
  ContextSlice['id'],
  { label: string; color: string }
> = {
  system: { label: 'System prompt', color: '#9ca3af' },
  skills: { label: 'Skills', color: '#f59e0b' },
  tools: { label: 'MCP tools', color: '#c084fc' },
  summarized: { label: 'Summarized conversation', color: '#fb7185' },
  conversation: { label: 'Conversation', color: '#34d399' },
  draft: { label: 'Current prompt', color: '#38bdf8' }
}

/** Estimate how the live meter total splits across prompt parts. */
export function buildContextSlices(options: {
  used: number
  systemPrompt?: string
  skillsText?: string
  tools: McpToolInfo[]
  messages: UiMessage[]
  draft: string
  attachments: ChatAttachment[]
}): ContextSlice[] {
  const system = estimateTokensFromText(options.systemPrompt ?? '')
  const skills = estimateTokensFromText(options.skillsText ?? '')
  const tools = estimateAgentToolTokens(
    options.tools,
    (options.skillsText ?? '').length > 0
  )
  const summarized = estimateSummarizedTokens(options.messages)
  const draft = estimateDraftTokens(options.draft, options.attachments)
  const parts: Array<{ id: ContextSlice['id']; tokens: number }> = [
    { id: 'system', tokens: system },
    { id: 'skills', tokens: skills },
    { id: 'tools', tokens: tools },
    { id: 'summarized', tokens: summarized },
    { id: 'draft', tokens: draft }
  ]
  const reserved = parts.reduce((n, p) => n + p.tokens, 0)
  const used = Math.max(0, options.used)
  const scale = reserved > used && reserved > 0 ? used / reserved : 1
  const scaled = parts.map((p) => ({
    ...p,
    tokens: Math.round(p.tokens * scale)
  }))
  const assigned = scaled.reduce((n, p) => n + p.tokens, 0)
  const conversation = Math.max(0, Math.round(used - assigned))
  const byId = new Map<ContextSlice['id'], number>([
    ...scaled.map((p) => [p.id, p.tokens] as const),
    ['conversation', conversation]
  ])
  const order: ContextSlice['id'][] = [
    'system',
    'skills',
    'tools',
    'summarized',
    'conversation',
    'draft'
  ]
  return order
    .map((id) => ({
      id,
      tokens: byId.get(id) ?? 0,
      label: SLICE_META[id].label,
      color: SLICE_META[id].color
    }))
    .filter((p) => p.tokens > 0)
}
