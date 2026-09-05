import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpServerConfig, McpToolInfo } from '../shared/types'

interface ConnectedServer {
  config: McpServerConfig
  client: Client
  transport: StdioClientTransport
  tools: McpToolInfo[]
}

function prefixToolName(serverId: string, toolName: string): string {
  const safeId = serverId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${safeId}__${toolName}`
}

function sanitizeEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

export function parsePrefixedToolName(prefixed: string): { serverId: string; toolName: string } | null {
  const idx = prefixed.indexOf('__')
  if (idx <= 0) return null
  return {
    serverId: prefixed.slice(0, idx),
    toolName: prefixed.slice(idx + 2)
  }
}

class McpManager {
  private connections = new Map<string, ConnectedServer>()

  isConnected(serverId: string): boolean {
    return this.connections.has(serverId)
  }

  getConnectedIds(): string[] {
    return [...this.connections.keys()]
  }

  async connect(config: McpServerConfig): Promise<McpToolInfo[]> {
    if (this.connections.has(config.id)) {
      await this.disconnect(config.id)
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env ? sanitizeEnv({ ...process.env, ...config.env }) : undefined,
      stderr: 'pipe'
    })

    const client = new Client({ name: 'ollama-mcp-client', version: '0.1.0' })

    try {
      await client.connect(transport)
      const listed = await client.listTools()
      const tools: McpToolInfo[] = (listed.tools ?? []).map((tool) => ({
        serverId: config.id,
        serverName: config.name,
        name: tool.name,
        prefixedName: prefixToolName(config.id, tool.name),
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown> | undefined
      }))

      this.connections.set(config.id, { config, client, transport, tools })
      return tools
    } catch (err) {
      try {
        await client.close()
      } catch {
        // ignore
      }
      throw err
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId)
    if (!conn) return
    this.connections.delete(serverId)
    try {
      await conn.client.close()
    } catch {
      // ignore
    }
  }

  async disconnectAll(): Promise<void> {
    const ids = [...this.connections.keys()]
    await Promise.all(ids.map((id) => this.disconnect(id)))
  }

  listAllTools(): McpToolInfo[] {
    const tools: McpToolInfo[] = []
    for (const conn of this.connections.values()) {
      tools.push(...conn.tools)
    }
    return tools
  }

  resolveToolDisplay(
    prefixedName: string
  ): { serverName: string; toolName: string } | null {
    for (const tool of this.listAllTools()) {
      if (tool.prefixedName === prefixedName) {
        return { serverName: tool.serverName, toolName: tool.name }
      }
    }
    return null
  }

  async refreshTools(serverId: string): Promise<McpToolInfo[]> {
    const conn = this.connections.get(serverId)
    if (!conn) return []
    const listed = await conn.client.listTools()
    conn.tools = (listed.tools ?? []).map((tool) => ({
      serverId: conn.config.id,
      serverName: conn.config.name,
      name: tool.name,
      prefixedName: prefixToolName(conn.config.id, tool.name),
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown> | undefined
    }))
    return conn.tools
  }

  async callTool(
    prefixedName: string,
    args: Record<string, unknown>
  ): Promise<{ ok: boolean; result: string }> {
    // Find by prefixed name first (exact match on stored tools)
    for (const conn of this.connections.values()) {
      const tool = conn.tools.find((t) => t.prefixedName === prefixedName)
      if (tool) {
        return this.executeTool(conn, tool.name, args)
      }
    }

    // Fallback: parse prefix using original server id characters may differ;
    // try matching sanitized id against connection keys.
    const parsed = parsePrefixedToolName(prefixedName)
    if (parsed) {
      for (const [id, conn] of this.connections) {
        const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_')
        if (safeId === parsed.serverId) {
          return this.executeTool(conn, parsed.toolName, args)
        }
      }
    }

    return { ok: false, result: `Unknown tool: ${prefixedName}` }
  }

  private async executeTool(
    conn: ConnectedServer,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ ok: boolean; result: string }> {
    try {
      const result = await conn.client.callTool({
        name: toolName,
        arguments: args
      })
      const text = formatToolResult(result)
      const isError = Boolean((result as { isError?: boolean }).isError)
      return { ok: !isError, result: text }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, result: message }
    }
  }
}

function formatToolResult(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return String(result)
  }
  const content = (result as { content?: unknown }).content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'type' in part) {
          const p = part as { type: string; text?: string }
          if (p.type === 'text' && typeof p.text === 'string') return p.text
        }
        return JSON.stringify(part)
      })
      .join('\n')
  }
  return JSON.stringify(result, null, 2)
}

export const mcpManager = new McpManager()
