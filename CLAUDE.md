# CLAUDE.md — Mastishk Agent Briefing

> Read this file at the start of every session. It is your permanent briefing for this project.
> Do not skip it. Do not summarise it. Read it fully.

---

## What this project is

**Mastishk** is an open protocol and TypeScript reference implementation for persistent, structured memory for AI coding agents.

The core idea: the `.mastishk/` folder belongs to the project, not to any single agent. Every agent — Claude Code, Cursor, GPT, custom API agents — reads from and writes to the same memory. One brain for every agent on your project.

- GitHub org: `github.com/mastishk-ai`
- npm packages: `@mastishk/core`, `@mastishk/cli`, `@mastishk/mcp`
- Domain: `mastishk.dev`
- License: Apache 2.0
- Language: TypeScript (strict mode)
- Protocol spec: `MASTISHK-SPEC.md`

---

## Memory structure

Every project using Mastishk has a `.mastishk/` folder:

```
.mastishk/
  intent/         ← long-term goals, objectives, constraints (changes rarely)
  state/          ← current tasks, progress, blockers, outcomes (changes often)
  knowledge/      ← architecture, decisions, tech stack, dependencies (grows over time)
  issues/         ← errors, bugs, blockers logged by agents or humans
  agents.json     ← registered agents and conflict strategy
  memory-map.json ← DAG index linking all nodes
```

Every memory file is a `.msk.md` file — markdown with YAML frontmatter. Example:

```yaml
---
id: goal-launch-v1
type: goal
layer: intent
status: active
confidence: 1.0
created_by: human
created_at: 2026-05-12T00:00:00Z
last_updated_by: claude-code
last_updated_at: 2026-05-12T00:00:00Z
dependencies: []
contradictions: []
---

Ship Mastishk v1 to npm and arXiv before June 2026.
```

---

## Source structure

```
mastishk/
  packages/
    core/         ← schema, validate, read, write, graph, traverse
    cli/          ← bin/mastishk.ts — all CLI commands
    mcp/          ← MCP server exposing tools to Claude Desktop, Cursor, Windsurf
  tests/
    unit/
    compliance/   ← protocol compliance suite (any implementation must pass these)
  docs/
  MASTISHK-SPEC.md
  METHODOLOGY.md
  CLAUDE.md       ← this file
```

---

## The six protocol claims (never deviate from these)

These are the core ideas Mastishk establishes as prior art. Every implementation decision must serve these claims:

1. **Layered memory** — three semantic layers: `intent`, `state`, `knowledge`. Each has different persistence, update frequency, and agent trust level.
2. **DAG traversal for context injection** — `inject(task)` traverses the dependency graph from matched nodes, not vector similarity or recency. Causality, not proximity.
3. **Filesystem-native markdown nodes** — `.msk.md` files with YAML frontmatter are the source of truth. Git-versionable, human-readable, portable.
4. **Git as episodic memory** — the git history of `.mastishk/` is the agent's cognitive history. Commits are checkpoints.
5. **Confidence-weighted nodes with contradiction detection** — every node has a `confidence` score (0.0–1.0). The Referee checks new writes against existing nodes before committing.
6. **Ambient capture** — memory stays current through post-commit git hooks and agent tool use, not manual updates.

---

## Your session workflow

**At the start of every session:**
1. Read this file fully
2. Read `MASTISHK-SPEC.md` — especially the section relevant to today's task
3. Read `.mastishk/state/` to understand current progress
4. Check `.mastishk/issues/` for any open blockers

**During the session:**
- If you implement something not in `MASTISHK-SPEC.md`, add a comment: `// SPEC-GAP: description`
- Never implement spec-divergent behaviour silently
- Tests live alongside source — write them in the same session as the code

**At the end of every session:**
- Update `.mastishk/state/progress.msk.md` with what was completed
- Mark any resolved issues in `.mastishk/issues/`
- If you hit an error, log it: `npx mastishk log --error "description"`
- Run `npm test` — do not end a session with failing tests

---

## Commands

```bash
npx @mastishk/cli init              # scaffold .mastishk/ in a project
npx @mastishk/cli inject "task"     # get context string for a task
npx @mastishk/cli update <id>       # update a memory node
npx @mastishk/cli log               # append to issues
npx @mastishk/cli scan              # infer memory from existing project
npx @mastishk/cli status            # show memory health
npx @mastishk/cli checkpoint        # git commit the memory folder
npx @mastishk/cli mcp               # start MCP server
```

---

## Critical rules

- **Spec first, code second.** If `MASTISHK-SPEC.md` does not describe it, do not build it without adding a `SPEC-GAP` comment.
- **Never break the compliance suite.** `tests/compliance/` defines what a valid Mastishk implementation is. All tests must pass before any commit.
- **Append-only for state, replace for knowledge.** State layer changes are always appended. Knowledge layer nodes are replaced with the latest version.
- **Conflict flag, never silent overwrite.** If a write contradicts an existing node, flag it — never silently overwrite.
- **TypeScript strict mode.** `"strict": true` in tsconfig. No `any` types without a comment explaining why.
- **One package, one responsibility.** `core` has no CLI or MCP dependencies. `cli` depends on `core`. `mcp` depends on `core`.

---

## Build phase tracker

| Phase | What | Status |
|---|---|---|
| 0 | CLAUDE.md + MASTISHK-SPEC.md + METHODOLOGY.md + GitHub repo | 🔲 |
| 1 | `@mastishk/core` — schema, validate, read, write | 🔲 |
| 2 | `@mastishk/core` — graph, traverse, inject | 🔲 |
| 3 | `@mastishk/cli` — init, inject, update, log, status | 🔲 |
| 4 | `@mastishk/mcp` — MCP server with all tools | 🔲 |
| 5 | `@mastishk/cli` — scan command | 🔲 |
| 6 | `tests/compliance/` — full compliance suite | 🔲 |
| 7 | arXiv submission + npm publish + mastishk.dev | 🔲 |

Update this table at the end of every session.
