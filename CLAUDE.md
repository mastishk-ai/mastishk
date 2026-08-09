# CLAUDE.md — Mastishk Agent Briefing

> Read this file at the start of every session. It is your permanent briefing for this project.
> Do not skip it. Do not summarise it. Read it fully.

---

## What this project is

**Mastishk** is an open protocol and TypeScript reference implementation for persistent, structured, **shared** memory for AI coding agents.

The core idea: the `.mastishk/` folder belongs to the project, not to any single agent. Every agent — Claude Code, Cursor, GPT, custom API agents — checks into the same brain through a session protocol: **check in → catch up → work → hand off**. Multiple coding agents, single brain.

- GitHub org: `github.com/mastishk-ai`
- npm packages: `@mastishk/core`, `@mastishk/cli`, `@mastishk/mcp`
- Domain: `mastishk.dev`
- License: Apache 2.0
- Language: TypeScript (strict mode)
- Protocol spec: `MASTISHK-SPEC.md` (v0.3 draft)
- Research plan: `docs/RESEARCH.md` (RelayBench)

---

## Memory structure

Every project using Mastishk has a `.mastishk/` folder:

```
.mastishk/
  intent/         ← goals, constraints, resources (changes rarely)
  state/          ← tasks, plans, progress, handoffs (changes every session)
  knowledge/      ← architecture, decisions, facts (grows over time)
  map/            ← codebase map: which file/module does what (v0.3)
  issues/         ← errors, bugs, blockers logged by agents or humans
  sessions/       ← active session registry (ephemeral, gitignored) (v0.3)
  agents.json     ← registered agents, trust levels, conflict strategy
  memory-map.json ← DAG index linking all nodes
```

Every memory file is a `.msk.md` file — markdown with YAML frontmatter (id, type, layer, status, confidence, timestamps, dependencies, contradictions). See spec §3 for the full schema, including v0.3 fields: `path`/`stale` (map nodes), `steps` (plan nodes).

---

## Source structure

```
mastishk-project/
  src/packages/
    core/         ← schema, validate, read, write, graph, traverse, inject
    cli/          ← src/bin.ts + src/commands/ — all CLI commands
    mcp/          ← MCP server exposing tools to Claude Desktop, Cursor, Windsurf
  tests/
    unit/
    compliance/   ← protocol compliance suite (any implementation must pass these)
  docs/           ← GUIDE.md, RESEARCH.md, paper.tex, index.html
  MASTISHK-SPEC.md
  METHODOLOGY.md
  CLAUDE.md       ← this file
```

(Note: packages live under `src/packages/`, not a top-level `packages/`.)

---

## The two core claims (never deviate from these)

Every implementation decision must serve these:

1. **Project-owned shared memory** — the memory folder belongs to the repository. The session protocol (presence, catchup, handoff — spec §15) makes multi-agent sharing explicit, not accidental.
2. **Structure-aware context injection** — `inject(task)` composes context by DAG traversal from matched nodes. Seeding is pluggable (keywords/BM25/embeddings); causal structure decides what's included. Similarity finds the door, causality walks the house.

Supporting mechanisms (spec/METHODOLOGY claims 1–9): three semantic layers, DAG traversal, `.msk.md` filesystem nodes, git as episodic memory, confidence + deterministic Referee, ambient capture, session protocol, catchup, codebase map with staleness contract.

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
npx @mastishk/cli init               # scaffold .mastishk/ in a project
npx @mastishk/cli session start ...  # check in: presence + catchup + inject (v0.3, 🚧)
npx @mastishk/cli session end        # hand off + checkpoint (v0.3, 🚧)
npx @mastishk/cli catchup            # what changed since my last session (v0.3, 🚧)
npx @mastishk/cli next               # first unblocked plan step (v0.3, 🚧)
npx @mastishk/cli inject "task"      # get causal context for a task
npx @mastishk/cli update <id>        # update a memory node
npx @mastishk/cli log                # append to issues
npx @mastishk/cli map [--stale]      # codebase map inspection (v0.3, 🚧)
npx @mastishk/cli scan               # infer memory from existing project
npx @mastishk/cli status             # show memory health
npx @mastishk/cli doctor             # lint the whole memory folder (v0.3, 🚧)
npx @mastishk/cli checkpoint         # git commit the memory folder
npx @mastishk/cli mcp                # start MCP server
npx @mastishk/cli instruct --agent … # onboard an agent (AGENTS.md canonical)
```

🚧 = specified in v0.3, not yet implemented. Implement only alongside its compliance tests.

---

## Critical rules

- **Spec first, code second.** If `MASTISHK-SPEC.md` does not describe it, do not build it without adding a `SPEC-GAP` comment.
- **Never break the compliance suite.** `tests/compliance/` defines what a valid Mastishk implementation is. All tests must pass before any commit.
- **Claims must match code.** Never describe a mechanism as working (README, paper, spec without a 🚧/draft marker) unless the reference implementation implements it and tests cover it.
- **Append-only for state, replace for knowledge.** State layer changes are always appended. Knowledge nodes are replaced; git history is their version record.
- **Conflict flag, never silent overwrite.** If a write contradicts an existing node, flag it — never silently overwrite.
- **A stale map is worse than no map.** Map nodes must be flagged stale when their files change, and stale entries must be visibly marked in all output.
- **TypeScript strict mode.** `"strict": true` in tsconfig. No `any` types without a comment explaining why.
- **One package, one responsibility.** `core` has no CLI or MCP dependencies. `cli` depends on `core`. `mcp` depends on `core`.

---

## Build phase tracker

| Phase | What | Status |
|---|---|---|
| 0 | CLAUDE.md + MASTISHK-SPEC.md + METHODOLOGY.md + GitHub repo | ✅ |
| 1 | `@mastishk/core` — schema, validate, read, write | ✅ |
| 2 | `@mastishk/core` — graph, traverse, inject | ✅ |
| 3 | `@mastishk/cli` — init, inject, update, log, status | ✅ |
| 3b | `@mastishk/cli` — enhanced init (prompts, nodes, hook), instruct, hook commands | ✅ |
| 4 | `@mastishk/mcp` — MCP server with all tools | ✅ |
| 5 | `@mastishk/cli` — scan command | ✅ |
| 6 | `tests/compliance/` — full compliance suite (v0.2) | ✅ |
| 7 | npm publish + arXiv (defensive pub) + mastishk.dev | ✅ (code ready — human publish pending) |
| 8 | Spec v0.3 + README/METHODOLOGY/RESEARCH restructure (shared-memory protocol) | ✅ 2026-06-12 |
| 9 | v0.3 core: schema v0.3 (new types/layers/fields), deterministic Referee, atomic writes + lock, trust enforcement, `commitNode` canonical write path | ✅ 2026-06-12 |
| 10 | v0.3 sessions: session start/end, catchup, handoff nodes, presence registry | ✅ 2026-08-10 |
| 11 | v0.3 map + plans: map layer, scan-generated map nodes, hook staleness flagging, plan nodes + `next`, `doctor` | ⬜ |
| 12 | v0.3 onboarding + compliance: AGENTS.md canonical instruct/init, new MCP tools, compliance suite for §15–§17 | ⬜ |
| 13 | RelayBench: E0 exploration-token pilot, then harness per docs/RESEARCH.md | ⬜ |
| 14 | Empirical paper rewrite of docs/paper.tex (after Phase 13 results) | ⬜ |

Update this table at the end of every session.

**Sequencing note:** Phases 9→12 are dependency-ordered. Each phase lands with its unit + compliance tests in the same session. The existing compliance suite tests v0.2 behaviour; when a v0.3 change alters v0.2 behaviour (e.g. inject output gains a Handoff section), update the corresponding compliance test in the same commit and record it in the spec changelog.

**Environment note (2026-06-12):** Node.js 24 LTS installed via winget at `C:\Program Files\nodejs`. Fresh shells pick it up from PATH; long-lived shells may need `$env:Path = "C:\Program Files\nodejs;$env:Path"`. If you cannot run `npm test`, do not modify `src/`.

## Mastishk memory

This project uses [Mastishk](https://mastishk.dev) for persistent shared agent memory.

- Memory folder: `.mastishk/`
- Get context: `npx mastishk inject "<your task>"`
- Log an issue: `npx mastishk log "description"`
- Check health: `npx mastishk status`
- (v0.3, once implemented: `mastishk session start` / `session end` / `catchup`)
