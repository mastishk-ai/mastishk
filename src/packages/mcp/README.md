# @mastishk/mcp

MCP server for the [Mastishk protocol](https://mastishk.dev) — exposes structured memory tools to Claude, Cursor, Windsurf, and any MCP-compatible agent.

## Install

```bash
npm install -g @mastishk/mcp
```

## Configure in Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mastishk": {
      "command": "npx",
      "args": ["mastishk-mcp"],
      "env": {
        "MASTISHK_DIR": "/path/to/your/project/.mastishk"
      }
    }
  }
}
```

## Configure in Cursor / Windsurf

Add to your MCP server config:

```json
{
  "mastishk": {
    "command": "npx mastishk-mcp",
    "env": { "MASTISHK_DIR": "${workspaceFolder}/.mastishk" }
  }
}
```

## Tools

Once connected, the agent has access to five tools:

| Tool | Purpose | Required params |
|---|---|---|
| `mastishk_inject` | Get structured memory context for a task | `task: string` |
| `mastishk_update` | Update or create a memory node | `id, content, layer` |
| `mastishk_log` | Append an issue or error to memory | `message: string` |
| `mastishk_status` | Return memory health summary | none |
| `mastishk_checkpoint` | Commit memory state to git | `message?: string` |

## Programmatic use

```typescript
import { createMastishkServer } from '@mastishk/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = createMastishkServer('/path/to/.mastishk');
await server.connect(new StdioServerTransport());
```

## Protocol

- Spec: [MASTISHK-SPEC.md](https://github.com/mastishk-ai/mastishk/blob/main/MASTISHK-SPEC.md)
- Website: [mastishk.dev](https://mastishk.dev)
- License: Apache 2.0
