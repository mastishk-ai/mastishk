# Mastishk

**One brain for every agent on your project.**

Persistent, structured memory for AI coding agents — built on markdown, backed by git, open to every agent.

```
npm install -g @mastishk/cli
npx mastishk init
npx mastishk inject "build JWT authentication"
```

---

## The problem

Claude Code, Cursor, and GPT agents are stateless. Every session starts with no memory of prior decisions, errors, or goals. You paste the same context over and over. Agents contradict each other. Progress is lost.

The usual fixes — `CLAUDE.md` files, vector RAG, proprietary memory layers — all fail the same way: they don't scale, they're not shared between agents, and they go stale.

## The solution

Mastishk gives your project a `.mastishk/` folder — a structured, git-backed memory that every agent reads from and writes to.

```
.mastishk/
  intent/         ← goals and constraints (rarely changes)
  state/          ← tasks, progress, blockers (changes every session)
  knowledge/      ← decisions, stack, architecture (grows over time)
  issues/         ← errors and blockers (never deleted, only resolved)
  memory-map.json ← dependency graph linking all nodes
```

Every memory node is a `.msk.md` file — markdown with YAML frontmatter. Human-readable, git-versionable, no database.

When an agent needs context, `mastishk inject "your task"` traverses the dependency graph from matched nodes and returns a structured context string. Causality, not similarity.

---

## Quick start

```bash
# Add memory to your project
npm install -g @mastishk/cli
cd your-project
mastishk init

# Tell your agent to inject context before starting a task
mastishk inject "build JWT authentication"

# Log an issue
mastishk log "Zod peer dep conflict with existing package"

# Check memory health
mastishk status

# Commit memory state to git
mastishk checkpoint
```

---

## MCP — for Claude, Cursor, Windsurf

Add the MCP server to get automatic memory access in any MCP-compatible agent:

```bash
npm install -g @mastishk/mcp
```

`claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "mastishk": {
      "command": "npx",
      "args": ["mastishk-mcp"],
      "env": { "MASTISHK_DIR": "/path/to/project/.mastishk" }
    }
  }
}
```

Five tools become available to the agent: `mastishk_inject`, `mastishk_update`, `mastishk_log`, `mastishk_status`, `mastishk_checkpoint`.

---

## The six protocol claims

Mastishk is a protocol, not just a library. Any implementation in any language that passes the compliance suite is Mastishk-compliant.

1. **Layered memory** — three semantic layers (`intent`, `state`, `knowledge`) with different persistence, update rules, and agent trust levels.
2. **DAG traversal** — `inject(task)` follows dependency edges from matched nodes. Causality, not cosine similarity.
3. **Filesystem-native nodes** — `.msk.md` files with YAML frontmatter. Git-versionable, human-readable, zero vendor dependency.
4. **Git as episodic memory** — `mastishk checkpoint` makes git history the agent's cognitive history.
5. **Confidence-weighted nodes** — every node has a `confidence` score (0.0–1.0). The Referee blocks contradicting writes.
6. **Ambient capture** — post-commit hooks and agent tool calls keep memory current without manual effort.

---

## Packages

| Package | Description |
|---|---|
| [`@mastishk/core`](src/packages/core) | Schema, validation, read/write, graph, inject |
| [`@mastishk/cli`](src/packages/cli) | `mastishk` CLI — init, inject, update, log, scan, status, checkpoint |
| [`@mastishk/mcp`](src/packages/mcp) | MCP server with 5 tools for Claude, Cursor, Windsurf |

---

## How it compares

| System | Storage | Structure | Multi-agent | Open protocol |
|---|---|---|---|---|
| Mem0 | Hosted vector DB | Flat | No | No |
| Graphiti | Neo4j | Graph | No | No |
| MemGPT / Letta | In-process | Hierarchical | No | No |
| LangMem | Vector + SQL | Flat | No | No |
| **Mastishk** | **Filesystem (markdown)** | **DAG (three-layer)** | **Yes** | **Yes** |

---

## Compliance

Any implementation that passes `tests/compliance/` is Mastishk-compliant and may be listed at [mastishk.dev/implementations](https://mastishk.dev/implementations).

The compliance suite tests all eight spec sections: node format, layer semantics, graph constraints, inject output, write-back contract, conflict detection, MCP tools, and CLI commands.

---

## Docs

- [Protocol spec — MASTISHK-SPEC.md](MASTISHK-SPEC.md)
- [Methodology and prior art — METHODOLOGY.md](METHODOLOGY.md)
- [arXiv paper](https://arxiv.org/abs/XXXX.XXXXX)

---

## License

Apache 2.0 — [github.com/mastishk-ai/mastishk](https://github.com/mastishk-ai/mastishk)
