import catalogJson from './mcp-catalog.json'
import type { CatalogServer, McpServerConfig } from './types'

export const MCP_CATALOG: CatalogServer[] = catalogJson as CatalogServer[]

export const MCP_CATEGORY_LABELS: Record<string, string> = {
  'official-and-reference': 'Official and Reference',
  'databases-and-storage': 'Databases and Storage',
  'developer-tools-and-code-intelligence': 'Developer Tools',
  'browsers-search-and-web-automation': 'Browsers, Search, and Web',
  'filesystems-and-documents': 'Filesystems and Documents',
  'cloud-and-infrastructure': 'Cloud and Infrastructure',
  'communication-and-productivity': 'Communication and Productivity',
  'ai-agents-and-memory': 'AI, Agents, and Memory',
  'data-analytics-and-bi': 'Data, Analytics, and BI',
  'security-and-identity': 'Security and Identity',
  'finance-commerce-and-business-apps': 'Finance and Commerce',
  'utilities-and-examples': 'Utilities and Examples'
}

/** Ordered category ids present in the catalog. */
export const MCP_CATEGORIES: string[] = [
  ...new Set(MCP_CATALOG.map((s) => s.category))
].sort((a, b) => {
  const la = MCP_CATEGORY_LABELS[a] ?? a
  const lb = MCP_CATEGORY_LABELS[b] ?? b
  return la.localeCompare(lb)
})

export function categoryLabel(id: string): string {
  return MCP_CATEGORY_LABELS[id] ?? id
}

/** Prefill a ServerForm / upsert payload from a catalog entry. */
export function catalogToServerDraft(entry: CatalogServer): McpServerConfig {
  const env: Record<string, string> | undefined = entry.install?.envHints?.length
    ? Object.fromEntries(
        entry.install.envHints
          .filter((h) => h.name !== 'NOTE')
          .map((h) => [h.name, ''])
      )
    : undefined

  return {
    id: crypto.randomUUID(),
    name: entry.name,
    command: entry.install?.command ?? 'npx',
    args: entry.install?.args ?? [],
    env: env && Object.keys(env).length ? env : undefined,
    enabled: true
  }
}

export function isCatalogServerAdded(
  entry: CatalogServer,
  servers: Array<{ name: string }>
): boolean {
  const target = entry.name.trim().toLowerCase()
  return servers.some((s) => s.name.trim().toLowerCase() === target)
}
