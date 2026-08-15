# Ollama MCP Client

Desktop app for chatting with local [Ollama](https://ollama.com) models that can call tools from [MCP](https://modelcontextprotocol.io) servers (stdio).

## Prerequisites

- Node.js 20+
- [Ollama](https://ollama.com/download) running locally
- A **tool-capable** model, for example:

```bash
ollama pull qwen3
# or
ollama pull llama3.1
```

## Setup

```bash
npm install
npm run dev
```

## Usage

1. Confirm the sidebar shows **Ollama → Connected** (default `http://127.0.0.1:11434`).
2. Select a model.
3. **Add** an MCP server (command + args), then **Connect**.
4. Chat — tool calls and results appear inline.

### Example: filesystem MCP server

Add a server with:

| Field   | Value |
|---------|--------|
| Name    | Filesystem |
| Command | `npx` |
| Args    | `-y @modelcontextprotocol/server-filesystem /tmp` |

Replace `/tmp` with a directory you want the model to access. Then click **Connect**.

Ask something like: “List the files in the allowed directory.”

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Electron in development |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Run the built app |
| `npm run typecheck` | TypeScript checks only |

## Architecture

- **Main process**: Ollama HTTP client, MCP stdio connections, agent/tool loop
- **Preload**: typed `window.api` bridge
- **Renderer**: React + Tailwind UI (sidebar + chat)

Tool names are prefixed as `{serverId}__{toolName}` so multiple servers can expose the same tool name.

## Notes

- MVP supports **stdio** MCP only (not SSE/HTTP).
- Use Ollama’s native `/api/chat` (not `/v1`) for reliable tool calling.
- Max 8 tool-call iterations per user turn.
