# Mastishk

**One brain for every agent on your project.**

Persistent, shared, structured memory for AI coding agents — built on markdown, backed by git, governed by a session protocol: **check in → catch up → work → hand off.**

```
npm install -g @mastishk/cli
mastishk init
mastishk session start --agent claude-code --task "build JWT authentication"
```

> **Status:** protocol spec v0.3 (draft). The reference implementation covers spec v0.2
> plus the v0.3 session protocol (sessions, catchup, handoff), write path (Referee, trust,
> atomic writes), and codebase map (map nodes, staleness contract, `next`, `doctor`).
> Still unbuilt — marked 🚧 below — are `AGENTS.md` as the canonical onboarding file and
> the three session MCP tools; tracked in the [build phases](CLAUDE.md). npm publish pending.

---

## The problem

Claude Code, Cursor, and GPT agents are stateless. Every session starts cold: the agent re-explores your repo, re-derives your architecture, and knows nothing about what the *previous* session — or a *different* agent — decided, fixed, or broke. You paste the same context over and over. Agents contradict each other. The understanding an agent builds at maximum context dies when the conversation ends.

The usual fixes — `CLAUDE.md` files, vector RAG, vendor memory layers — all fail the same way: they're flat, they go stale, and they belong to one agent instead of the project.

## The solution

Mastishk gives your **project** a brain that every agent shares. Memory lives in a `.mastishk/` folder — structured markdown nodes, indexed as a dependency graph, versioned by git — and agents interact with it through an explicit session lifecycle:

```
mastishk session start   →  who else is active, what changed since you were
                            last here, the previous session's handoff, and
                            causal context for your task
        (work)           →  agents update state, log issues, refresh the map
mastishk session end     →  write a handoff: Done / In flight /
                            Watch out / Next
```

So when Claude Code works Monday and you open Cursor on Tuesday:

```
$ mastishk catchup --agent cursor

Since your last session (2 days ago):
  Handoff from claude-code: JWT auth done; refresh rotation half-done —
    see src/auth/refresh.ts TODO line 40. Don't upgrade jsonwebtoken past v9.
  Resolved: task-jwt-auth
  New issue: refresh tokens expire early under clock skew
  Next unblocked step: task-rate-limiting
```

One command. Cursor now knows everything Claude Code learned. **Multiple agents, single brain.**

---

## Memory structure

```
.mastishk/
  intent/         ← goals, constraints, resources (rarely changes)
  state/          ← tasks, plans, progress, handoffs (changes every session)
  knowledge/      ← decisions, stack, architecture (grows over time)
  map/            ← which file does what — agents stop re-exploring
  issues/         ← errors and blockers (never deleted, only resolved)
  sessions/       ← who's active right now (ephemeral)
  agents.json     ← registered agents, trust levels, conflict strategy
  memory-map.json ← dependency graph linking all nodes
```

Every memory node is a `.msk.md` file — markdown with YAML frontmatter. Human-readable, git-versionable, no database, no vendor.

When an agent needs context, `mastishk inject "your task"` matches entry nodes, then **traverses the dependency graph** — so a task brings along the goal it serves and the constraints that bind it. Similarity finds the door; causality walks the house.

---

## Quick start

```bash
npm install -g @mastishk/cli
cd your-project
mastishk init        # scaffolds .mastishk/, prompts for goals/resources,
                     # installs git hook, writes CLAUDE.md briefing
                     # (AGENTS.md as canonical target 🚧)

# Connect agents (each one reads the same brain)
mastishk instruct --agent claude-code   # CLAUDE.md briefing (AGENTS.md 🚧)
mastishk instruct --agent cursor        # .cursor/mcp.json — restart Cursor
mastishk instruct --agent windsurf      # .windsurf/mcp.json — restart Windsurf
mastishk instruct --agent api           # stdout — pipe into any custom agent

# Daily use
mastishk inject "build JWT authentication"   # causal context for a task
mastishk next                                # first unblocked plan step
mastishk log "Zod peer dep conflict"         # log an issue
mastishk status                              # memory health
mastishk map --stale                         # map entries that need re-verifying
mastishk doctor                              # full memory folder lint
mastishk checkpoint                          # commit memory state to git
```

After `mastishk init`, every `feat:`/`fix:`/`wip:` commit updates state memory automatically via the post-commit hook, and commits that touch mapped files flag their map entries stale — memory stays current even when nobody maintains it.

---

## Connecting agents

Any agent that opens the project discovers Mastishk through `CLAUDE.md`. (Spec §14 makes `AGENTS.md` — the ecosystem-standard agent instruction file — the canonical location, with `CLAUDE.md` as its mirror; that switch is 🚧.) For MCP-capable agents:

```bash
npm install -g @mastishk/mcp
```

`claude_desktop_config.json` / `.cursor/mcp.json` / `.windsurf/mcp.json`:
```json
{
  "mcpServers": {
    "mastishk": {
      "command": "npx",
      "args": ["@mastishk/mcp", "--memory-dir", ".mastishk"]
    }
  }
}
```

Tools exposed: `mastishk_inject`, `mastishk_update`, `mastishk_log`, `mastishk_status`, `mastishk_checkpoint`, plus `mastishk_session_start`, `mastishk_session_end`, `mastishk_catchup` 🚧.

---

## The two core claims

Mastishk is a protocol, not just a library. Any implementation in any language that passes the compliance suite is Mastishk-compliant. The protocol makes two claims:

1. **Project-owned shared memory.** The memory folder belongs to the repository, not to any agent or vendor. A session protocol — presence, catchup, handoff — makes multi-agent collaboration explicit: agents check into the brain, not just read a file.
2. **Structure-aware context injection.** Context is assembled by traversing a typed dependency graph from task-matched nodes. Seeding is pluggable (keywords, BM25, embeddings); what's protocol-defined is that *causal structure*, not similarity, determines the final context.

In service of these: three semantic layers with different trust and persistence, a codebase map with a staleness contract, confidence-weighted nodes, a deterministic conflict Referee, git as episodic memory, and ambient capture via git hooks.

---

## How it compares

| | Storage | Structure | Shared across agents | Session/handoff protocol | Open spec |
|---|---|---|---|---|---|
| Vendor memory (Mem0, Letta, LangMem)* | Vendor DB | Flat or vendor graph | ✗ | ✗ | ✗ |
| CLAUDE.md / rules files | One markdown file | Flat | partially | ✗ | ✗ |
| Vector RAG | Embedding index | Similarity only | ✗ | ✗ | ✗ |
| **Mastishk** | **Repo filesystem (markdown + git)** | **Typed DAG, 3 layers + map** | **✓** | **✓** | **✓** |

\* characterisations as of mid-2026; see [METHODOLOGY.md](METHODOLOGY.md) for detailed comparison.

---

## Research

Mastishk was born from doing research projects with coding agents. The claims are designed to be falsifiable, and the evaluation plan — a multi-session, multi-agent **relay benchmark** measuring task continuity, exploration-token cost, and constraint violations across agent handoffs — lives in [docs/RESEARCH.md](docs/RESEARCH.md).

---

## Packages

| Package | Description |
|---|---|
| [`@mastishk/core`](src/packages/core) | Schema, validation, read/write, graph, traverse, inject |
| [`@mastishk/cli`](src/packages/cli) | `mastishk` CLI — all commands |
| [`@mastishk/mcp`](src/packages/mcp) | MCP server for Claude, Cursor, Windsurf |

## Compliance

Any implementation that passes `tests/compliance/` is Mastishk-compliant and may be listed at [mastishk.dev/implementations](https://mastishk.dev/implementations). The suite covers: node format, layer semantics, graph constraints, inject format, the write-back contract and Referee, MCP tools, CLI commands, and (v0.3) the session protocol, catchup, map staleness, and trust enforcement.

## Docs

- [Protocol spec — MASTISHK-SPEC.md](MASTISHK-SPEC.md)
- [Methodology and prior art — METHODOLOGY.md](METHODOLOGY.md)
- [Research & benchmark plan — docs/RESEARCH.md](docs/RESEARCH.md)
- [User guide — docs/GUIDE.md](docs/GUIDE.md)

## License

Apache 2.0 — [github.com/mastishk-ai/mastishk](https://github.com/mastishk-ai/mastishk)
