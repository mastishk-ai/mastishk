# @mastishk/cli

CLI for the [Mastishk protocol](https://mastishk.dev) — add persistent structured memory to any project.

## Install

```bash
npm install -g @mastishk/cli
# or use with npx
npx @mastishk/cli init
```

## Quick start

```bash
# 1. Add Mastishk memory to your project
npx mastishk init

# 2. Get memory context for your current task
npx mastishk inject "build JWT authentication"

# 3. Log an issue or error
npx mastishk log "Zod version conflict with existing deps"

# 4. Check memory health
npx mastishk status

# 5. Commit memory state to git
npx mastishk checkpoint
```

## Commands

### `mastishk init [--template <name>]`
Scaffold `.mastishk/` folder structure, create `memory-map.json` and `agents.json`, and append a Mastishk section to `CLAUDE.md` if present.

### `mastishk inject <task>`
Get structured memory context for a task. Output is a formatted string ready for use in an agent system prompt — DAG traversal from matched nodes, not keyword search.

### `mastishk update <id> [--status <status>] [--confidence <float>]`
Update the status or confidence of an existing memory node.

### `mastishk log [--error] <message>`
Append an issue or error to `.mastishk/issues/`. Creates a new `issue-{timestamp}.msk.md` node.

### `mastishk scan`
Infer memory from the existing project — reads `package.json`, `git log`, and `README.md` to create starter knowledge and state nodes.

### `mastishk status`
Show memory health: node count by layer and status, open issues, stale nodes.

### `mastishk checkpoint [--message <msg>]`
Git commit the current `.mastishk/` state as a memory checkpoint.

### `mastishk mcp`
Start the MCP server (see `@mastishk/mcp`).

## Memory structure

```
.mastishk/
  intent/         ← long-term goals and constraints
  state/          ← current tasks, progress, blockers
  knowledge/      ← architecture decisions, tech stack
  issues/         ← errors, bugs, blockers
  agents.json     ← registered agents and conflict strategy
  memory-map.json ← DAG index
```

## Protocol

- Spec: [MASTISHK-SPEC.md](https://github.com/mastishk-ai/mastishk/blob/main/MASTISHK-SPEC.md)
- Website: [mastishk.dev](https://mastishk.dev)
- License: Apache 2.0
