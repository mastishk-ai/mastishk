# @mastishk/cli

CLI for the [Mastishk protocol](https://mastishk.dev) — persistent, **shared** memory for AI coding agents.

The `.mastishk/` folder belongs to your repository, not to any one agent. Claude Code, Cursor,
and custom API agents all check into the same brain through a session protocol:
**check in → catch up → work → hand off.**

Implements protocol spec **v0.3**.

## Install

```bash
npm install -g @mastishk/cli
# or
npx @mastishk/cli init
```

## Quick start

```bash
cd your-project
mastishk init                    # scaffold .mastishk/, write AGENTS.md, install git hook
mastishk scan                    # infer memory from package.json, git log, README, source files

# every session, first thing
mastishk session start --agent claude-code --task "add refresh token rotation"

# ... work ...

mastishk session end             # write a handoff, checkpoint memory to git
```

When a different agent opens the project tomorrow, `mastishk session start` hands it the
previous session's handoff, what changed since it was last here, and the causal context for
its task — plus a warning about any codebase-map entry that has gone stale.

## Commands

### Session protocol

#### `mastishk session start --agent <id> [--task <task>]`
Check in. Registers presence, warns about other active agents, then prints your catchup and
the injected context for the task. Read all of it before starting work.

#### `mastishk session end [--agent <id>] [--handoff <text>]`
Hand off. Writes a handoff node covering Done / In flight / Watch out / Next, records your
session, and checkpoints memory to git. Prompts for the four sections when run interactively.

#### `mastishk catchup [--agent <id>]`
What changed since your last session: the most recent handoff, tasks resolved, new issues,
new knowledge, stale map entries, and the next unblocked plan step.

### Working with memory

#### `mastishk inject <task>`
Structured context for a task. Matched entry nodes, then **DAG traversal** — so a task brings
along the goal it serves and the constraints that bind it. Similarity finds the door;
causality walks the house.

#### `mastishk next`
The first unblocked step of the most recently updated active plan.

#### `mastishk map [--stale] [--refresh <id>]`
Inspect the codebase map — which file does what. `--stale` lists entries whose files changed
since the entry was written; `--refresh` clears the flag once you have verified one.

#### `mastishk update <id> [--status <status>] [--confidence <float>]`
Update a node's status or confidence.

#### `mastishk log [--error] <message>`
Append an issue, error, or blocker to `.mastishk/issues/`.

### Health and maintenance

#### `mastishk status`
Memory health: node counts by layer and status, open issues, expired nodes.

#### `mastishk doctor`
Lint the whole memory folder — schema, layer/type pairing, graph constraints, ID uniqueness,
index drift, expired nodes, stale map entries, long-running sessions. Exits non-zero on any
spec violation, so it works in CI.

#### `mastishk scan`
Infer starter memory from an existing project: `package.json`, `git log`, `README.md`, and a
walk of your source files to seed the codebase map.

#### `mastishk checkpoint [--message <msg>]`
Git commit the current `.mastishk/` state.

### Setup

#### `mastishk init [--template <name>]`
Scaffold `.mastishk/`, create `memory-map.json` and `agents.json`, write the agent briefing
into `AGENTS.md` (canonical) and `CLAUDE.md` (mirror), and install a post-commit hook.

#### `mastishk instruct --agent <claude-code|cursor|windsurf|api>`
Onboard an agent. Writes `AGENTS.md` + `CLAUDE.md` for Claude Code, or the MCP config for
Cursor and Windsurf. Re-run it to refresh an out-of-date briefing.

#### `mastishk mcp`
Start the MCP server (see [`@mastishk/mcp`](https://www.npmjs.com/package/@mastishk/mcp)).

#### `mastishk hook`
Run by the post-commit hook. Appends commit activity to state memory and flags codebase-map
entries whose files the commit touched.

## Memory structure

```
.mastishk/
  intent/         ← goals, constraints, resources (rarely changes)
  state/          ← tasks, plans, progress, handoffs (append-only)
  knowledge/      ← decisions, architecture, facts
  map/            ← which file does what, with a staleness contract
  issues/         ← errors and blockers (never deleted, only resolved)
  sessions/       ← who is active right now (ephemeral, gitignored)
  agents.json     ← registered agents, trust levels, conflict strategy
  memory-map.json ← the dependency graph index
```

Every node is a `.msk.md` file — markdown with YAML frontmatter. Human-readable,
git-versionable, no database, no vendor lock-in.

## Ambient capture

After `mastishk init`, every `feat:`/`fix:`/`wip:` commit appends to state memory
automatically, and any commit touching a mapped file flags that map entry stale. A stale map
entry is worse than no entry, so stale entries are visibly marked everywhere they surface.

## Protocol

Mastishk is a protocol, not just a tool. Any implementation in any language that passes the
compliance suite is Mastishk-compliant.

- Spec: [MASTISHK-SPEC.md](https://github.com/mastishk-ai/mastishk/blob/master/MASTISHK-SPEC.md)
- Website: [mastishk.dev](https://mastishk.dev)
- License: Apache 2.0
