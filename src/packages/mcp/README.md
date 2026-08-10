# @mastishk/mcp

MCP server for the [Mastishk protocol](https://mastishk.dev) — exposes structured **shared**
memory tools to Claude, Cursor, Windsurf, and any MCP-compatible agent.

Implements protocol spec **v0.3**, including the session protocol: agents check into the same
project brain, catch up on what changed, work, and hand off.

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

Once connected, the agent has access to eight tools.

**The session protocol** — an agent should call `mastishk_session_start` before anything else,
and `mastishk_session_end` before the conversation ends:

| Tool | Purpose | Required params |
|---|---|---|
| `mastishk_session_start` | Check in: who else is active, what changed since your last session, context for your task | `agent, task` |
| `mastishk_session_end` | Hand off: write a handoff note, deregister, checkpoint | `handoff` |
| `mastishk_catchup` | What changed since your last session, without starting a new one | `agent` |

**Working with memory:**

| Tool | Purpose | Required params |
|---|---|---|
| `mastishk_inject` | Get structured memory context for a task | `task` |
| `mastishk_update` | Update or create a memory node (`path` required for the `map` layer) | `id, content, layer` |
| `mastishk_log` | Append an issue or error to memory | `message` |
| `mastishk_status` | Return memory health summary | none |
| `mastishk_checkpoint` | Commit memory state to git | none |

Rewriting a `map` node through `mastishk_update` clears its stale flag — that is how an agent
verifies and refreshes a codebase-map entry it relied on.

## Programmatic use

```typescript
import { createMastishkServer } from '@mastishk/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = createMastishkServer('/path/to/.mastishk');
await server.connect(new StdioServerTransport());
```

## Protocol

- Spec: [MASTISHK-SPEC.md](https://github.com/mastishk-ai/mastishk/blob/master/MASTISHK-SPEC.md)
- Website: [mastishk.dev](https://mastishk.dev)
- License: Apache 2.0
