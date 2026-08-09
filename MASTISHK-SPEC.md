# MASTISHK-SPEC.md
# Mastishk Protocol Specification
# Version 0.3 — Draft

**Authors:** Mastishk Protocol Contributors
**Organisation:** github.com/mastishk-ai
**Published:** 2026-05-12 (v0.1) · **Revised:** 2026-06-12 (v0.3)
**License:** Apache 2.0
**Status:** Draft — seeking community review

> **Implementation status:** the reference TypeScript implementation covers v0.2
> behaviour plus the v0.3 write path (section 8.3 Referee, section 17 concurrency
> and trust), the v0.3 session protocol (section 15, including catchup and handoff
> nodes), and the v0.3 codebase map with its staleness contract (sections 4.4 and
> 16.1, plus `next`, `map` and `doctor` in section 11). The remaining v0.3 gaps are
> AGENTS.md as the canonical onboarding file (section 14) and the three v0.3 MCP
> tools (section 10); both are marked **[v0.3 — not yet in reference
> implementation]** and tracked in the build phase table in `CLAUDE.md`. A section
> without that marker is implemented and covered by the compliance suite.

---

## Abstract

Mastishk is an open protocol for persistent, structured, filesystem-native **shared memory** for AI coding agents. The memory belongs to the project, not to any single agent: every agent — Claude Code, Cursor, GPT-based tools, custom API agents — checks into the same brain, catches up on what other agents did, works, and hands off.

The protocol makes two core claims:

1. **Project-owned shared memory.** Memory is stored in the project repository as markdown files with YAML frontmatter, versioned by git, and governed by a session protocol (check in → catch up → work → hand off) that makes multi-agent collaboration explicit rather than accidental.
2. **Structure-aware context injection.** Context for a task is assembled by traversing a typed dependency graph from task-matched seed nodes — similarity may find the entry point, but causal structure determines what is included.

All other mechanisms in this specification — layers, confidence scores, the Referee, ambient capture, the codebase map — are in service of these two claims.

---

## 1. Motivation

Current AI coding agents are stateless by default. Each session starts with no knowledge of prior decisions, errors, architecture choices, or goals. When multiple agents work on the same project, each maintains (at best) its own private memory, invisible to the others.

The existing workarounds share predictable failure modes:

- **Token inefficiency** — flat context files are injected whole; agents re-explore the codebase from scratch every session
- **Vendor lock-in** — memory stored in one agent's system is inaccessible to others
- **No causal structure** — similarity-based retrieval cannot represent goal→plan→task→constraint relationships
- **No handoff** — when one session ends, what the agent learned at maximum context dies with the conversation

Mastishk addresses these by treating project memory as a structured, human-readable, git-backed graph that any agent can read from and write to, with an explicit protocol for session lifecycle and agent handoff.

---

## 2. Definitions

- **Node** — a single `.msk.md` file representing one unit of memory
- **Layer** — a semantic category of memory: `intent`, `state`, or `knowledge` — plus two operational stores, `map` and `issues`
- **Graph** — the DAG formed by dependency links between nodes, indexed in `memory-map.json`
- **Inject** — the operation that traverses the graph and returns a context string for an agent prompt
- **Session** — one continuous work period by one agent, delimited by `session start` and `session end`
- **Handoff** — a structured note written at session end, addressed to the next session
- **Catchup** — the operation that summarises what changed in memory since an agent's last session
- **Referee** — the validation layer that checks new writes for contradictions before committing
- **Compliance** — an implementation passes all tests in `tests/compliance/`

The keywords MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY in this document follow RFC 2119.

---

## 3. Memory structure

Every project using Mastishk has a `.mastishk/` folder:

```
.mastishk/
  intent/         ← goals, constraints, resources (changes rarely)
  state/          ← tasks, plans, progress, handoffs (changes every session)
  knowledge/      ← architecture, decisions, facts (grows over time)
  map/            ← codebase map: which file/module does what   [v0.3]
  issues/         ← errors, bugs, blockers (never deleted, only resolved)
  sessions/       ← active session registry (ephemeral, not committed) [v0.3]
  agents.json     ← registered agents, trust levels, conflict strategy
  memory-map.json ← DAG index linking all nodes
```

`intent`, `state`, and `knowledge` are the three **semantic layers**. `map` and `issues` are **operational stores** that follow the same node format. `sessions/` holds ephemeral runtime data and MUST be excluded from version control (implementations MUST write a `.mastishk/.gitignore` containing `sessions/` on init).

### 3.1 File naming

Every memory node MUST be stored as a file with the `.msk.md` extension, at:

```
{layer}/{id}.msk.md
```

Where `{layer}` is one of `intent`, `state`, `knowledge`, `map`, `issues`, and `{id}` is a kebab-case string unique within the project memory.

**ID uniqueness** is defined as: the `id` field in a node's frontmatter MUST equal its filename (minus extension), and no two `.msk.md` files under `.mastishk/` may declare the same `id`. A compliant implementation MUST raise a typed error when loading a memory folder that violates this.

### 3.2 YAML frontmatter

Every `.msk.md` file MUST begin with a YAML frontmatter block delimited by `---`. Required fields:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier, kebab-case, matches filename |
| `type` | enum | See section 3.3 |
| `layer` | enum | One of: `intent`, `state`, `knowledge`, `map`, `issues` |
| `status` | enum | One of: `active`, `resolved`, `deprecated`, `draft` |
| `confidence` | float | 0.0–1.0. Human-set = 1.0. Human-verified = 0.8. Agent-inferred = 0.6. Unverified = 0.3 |
| `created_by` | string | Agent ID or `human` |
| `created_at` | ISO 8601 | Creation timestamp |
| `last_updated_by` | string | Agent ID or `human` |
| `last_updated_at` | ISO 8601 | Last update timestamp |
| `dependencies` | string[] | IDs of nodes this node depends on |
| `contradictions` | string[] | IDs of nodes this node contradicts |

Optional fields:

| Field | Type | Description |
|---|---|---|
| `tags` | string[] | Free-form tags for search |
| `scanned` | boolean | `true` if created by `mastishk scan`, not by human or explicit agent |
| `verified` | boolean | `true` if a human has confirmed this node's content |
| `expires_at` | ISO 8601 | After this date, node SHOULD be flagged for review |
| `path` | string | **[v0.3]** Repo-relative file/directory path — required for `map` nodes |
| `stale` | boolean | **[v0.3]** `true` if the node may be outdated (set by ambient capture) |
| `steps` | string[] | **[v0.3]** Ordered task IDs — only on `plan` nodes |

### 3.3 Node types per layer

| Layer | Allowed `type` values |
|---|---|
| `intent` | `goal`, `constraint`, `resource` **[v0.3]** |
| `state` | `task`, `plan` **[v0.3]**, `handoff` **[v0.3]** |
| `knowledge` | `decision`, `fact` |
| `map` | `file` **[v0.3]** |
| `issues` | `issue` |

A compliant implementation MUST reject a write whose `type` is not allowed in its `layer`.

### 3.4 Body content

The body following the YAML frontmatter MUST be valid markdown. It SHOULD be concise — one to five sentences for most nodes. Long-form content SHOULD be linked to external files, not embedded.

### 3.5 Example node

```
---
id: goal-launch-v1
type: goal
layer: intent
status: active
confidence: 1.0
created_by: human
created_at: 2026-05-12T00:00:00Z
last_updated_by: human
last_updated_at: 2026-05-12T00:00:00Z
dependencies: []
contradictions: []
tags: [launch, v1, npm]
---

Ship @mastishk/cli to npm and submit the arXiv paper before June 2026.
Target: 100 GitHub stars within 30 days of launch.
```

---

## 4. Layer semantics

### 4.1 intent/

Long-term goals, objectives, constraints, and resources. Changes rarely; highest persistence and trust.

- Nodes MUST have `type` of `goal`, `constraint`, or `resource`
- A `resource` node **[v0.3]** records what the project has to work with: datasets, APIs and keys available, compute limits, budget, deadlines
- Agents MUST NOT modify `intent` nodes without explicit human confirmation
- A compliant implementation SHOULD warn before any agent write to this layer

### 4.2 state/

Current tasks, plans, progress, blockers, and handoffs. Changes every session.

- Nodes MUST have `type` of `task`, `plan`, or `handoff`
- State writes MUST be append-only — existing content is never overwritten; new content is appended with a timestamp header (section 8.2)
- A resolved task MUST update `status: resolved` and `last_updated_*` fields

**Plan nodes.** A `plan` node represents an ordered implementation plan. Its `steps` field lists task node IDs in intended execution order; each listed task SHOULD declare its blocking tasks in `dependencies`. A task is **unblocked** when every *task* node in its `dependencies` has `status: resolved` — dependencies of other types (goals, constraints) express purpose, not ordering, and do not block. Implementations MUST support the query "first unblocked step of the active plan" (CLI: `mastishk next`, section 11).

**Handoff nodes [v0.3].** A `handoff` node is written at session end (section 15). Its body SHOULD contain four sections: **Done**, **In flight**, **Watch out**, **Next**. Inject and catchup MUST surface the most recent active handoff before all other content.

### 4.3 knowledge/

Architecture decisions, technical facts, stack choices, accumulated understanding. Grows over time.

- Nodes MUST have `type` of `decision` or `fact`
- Knowledge writes MAY replace the body content; prior versions are preserved by git history (section 7), which is the canonical version record — implementations MUST NOT require any in-file history format
- High-confidence knowledge nodes (`confidence >= 0.8`) MAY be treated as constraints by the Referee

### 4.4 map/ — the codebase map  [v0.3]

The `map` store answers "which file does what" so agents do not re-explore the repository every session.

- Every node MUST have `type: file` and a `path` field with a repo-relative file or directory path
- The body SHOULD state: purpose, key exports/entry points, and gotchas — in five sentences or fewer
- Map nodes are typically created by `mastishk scan` (`confidence: 0.6, scanned: true`) and refined by agents during sessions
- **Staleness contract:** when ambient capture (section 16) observes a commit touching a path covered by a map node, the implementation MUST set `stale: true` on that node. Inject MUST render stale map nodes with a `(stale)` marker. Agents SHOULD verify and refresh stale nodes they rely on, clearing the flag
- A stale map entry is worse than no entry; implementations MUST NOT serve map content as authoritative once flagged stale

### 4.5 issues/

A dedicated log for errors, bugs, and blockers.

- Every issue node MUST have `type: issue`
- Issues MUST never be deleted, only resolved via `status: resolved`
- An unresolved issue with `expires_at` in the past MUST be surfaced by `mastishk status`

---

## 5. The graph

### 5.1 memory-map.json

Every Mastishk memory folder MUST contain a `memory-map.json` file at its root. This file is the graph index. It MUST be updated on every node write.

Required structure:

```json
{
  "version": "0.3",
  "updated_at": "2026-06-12T00:00:00Z",
  "nodes": {
    "goal-launch-v1": {
      "file": "intent/goal-launch-v1.msk.md",
      "layer": "intent",
      "type": "goal",
      "status": "active",
      "confidence": 1.0,
      "dependencies": [],
      "tags": ["launch", "v1"],
      "keywords": ["ship", "npm", "arxiv", "stars"]
    }
  },
  "edges": [
    { "from": "task-write-spec", "to": "goal-launch-v1", "relation": "serves" }
  ]
}
```

The `keywords` field **[v0.3]** is an optional cache of salient terms extracted from the node body, maintained on every write, so that inject seeding (section 6.2) can match body content without reading every file.

### 5.2 Graph constraints

A compliant implementation MUST enforce:

- **No cycles** — the dependency graph MUST be a DAG
- **No dangling references** — every ID in `dependencies`, `contradictions`, or `steps` MUST correspond to a node in `memory-map.json`
- **Unique IDs** — as defined in section 3.1

A compliant implementation MUST throw a typed error if any of these constraints are violated.

### 5.3 Traversal

Graph traversal starts from one or more seed nodes and follows dependency edges outward. The traversal function MUST accept:

- `seedIds: string[]` — starting node IDs
- `depth: number` — maximum hops from seed (default: 2)
- `statusFilter: string[]` — only include nodes with these statuses (default: `['active']`)
- `minConfidence: number` — exclude nodes below this confidence (default: 0.5)

---

## 6. The inject interface

### 6.1 Purpose

`inject(task)` accepts a natural language task description and returns a formatted context string ready for use in an agent system prompt.

### 6.2 Seeding: similarity finds the door

Seed selection identifies entry points into the graph. A compliant implementation MUST match task terms against node `id`, `tags`, and body content (directly or via the `keywords` cache, section 5.1), and rank candidate seeds by match score, tie-broken by confidence descending.

Seed selection is **pluggable** **[v0.3]**: implementations MAY substitute richer seeders (BM25, embedding similarity) provided the traversal and output stages below are unchanged. The protocol's claim is about what happens *after* seeding: causal structure, not similarity, determines the final context.

### 6.3 Algorithm

A compliant `inject` implementation MUST:

1. Select seed nodes per section 6.2
2. Traverse the graph from seeds at depth 2
3. Filter to `status: active` nodes with `confidence >= 0.5`
4. Include the most recent active `handoff` node regardless of seed match **[v0.3]**
5. Sort results: handoff first, then `intent`, `state`, `knowledge`, `map`, `issues`
6. Format output per section 6.4
7. Enforce the output budget (section 6.5) — truncate by dropping lowest-confidence nodes first; the handoff node MUST NOT be dropped

### 6.4 Output format

```
## Mastishk context — {task}
Generated: {ISO timestamp}

### Handoff from last session        [v0.3 — only if an active handoff exists]
{most recent handoff node, full body}

### Goals
{intent layer nodes}

### Current state
{state layer nodes; if an active plan exists, ends with "Next unblocked step: {task id}"}

### Knowledge
{knowledge layer nodes}

### Codebase map                      [v0.3 — only if map nodes matched]
{map nodes, stale ones marked "(stale)"}

### Open issues
{issues nodes with status: active}
```

Each node (other than the handoff) MUST render as:
```
**{id}** [{confidence}] — {body first sentence}
```

A compliant implementation MUST NOT include node body content beyond the first sentence in inject output, unless the node has `confidence >= 0.9` or is the surfaced handoff.

### 6.5 Output budget

The output budget is defined in **characters**, not tokens: 8,000 characters by default (approximately 2,000 tokens), configurable per call. Character counting is deterministic and model-independent; implementations MUST count the full rendered output including headers.

---

## 7. Git as episodic memory

The git history of `.mastishk/` is the project's episodic memory: a timestamped, immutable record of how understanding evolved.

- `mastishk checkpoint` commits the current memory state with a structured commit message
- Knowledge-node version history is git history (section 4.3)
- Catchup (section 15.4) is computed from this history
- Implementations SHOULD prefix memory commits with `mastishk:` so they are filterable

---

## 8. The write-back contract

### 8.1 Agent writes

Any agent performing a write MUST:

1. Provide its agent ID in `last_updated_by`
2. Update `last_updated_at` to the current timestamp
3. Pass the new node through the Referee before committing
4. Be subject to trust enforcement (section 17) **[v0.3]**

### 8.2 Append-only for state

For nodes in the `state` layer, a compliant implementation MUST append new content below existing content, separated by a timestamp header:

```markdown
### 2026-05-12T10:30:00Z — claude-code

Completed JWT implementation. Refresh token rotation working.
```

### 8.3 The Referee

The Referee runs before every write commit. It has a mandatory deterministic core and an optional semantic extension.

**Deterministic core (MUST):**

1. If the incoming node lists existing nodes in `contradictions`, or any existing active node lists the incoming node's ID in its `contradictions`, the write is a **declared conflict**
2. On a declared conflict, the implementation MUST apply the `conflict_strategy` from `agents.json` (section 9):
   - `flag` — reject the write, create a conflict node in `issues/`, and halt
   - `human` — reject the write and require human resolution before retry
   - `latest` — accept the write and mark the contradicted node `status: deprecated`
3. The conflict node MUST have `type: issue`, `tags: [conflict, referee]`, `dependencies` referencing the contradicting (existing) node IDs, and a body identifying the rejected write's ID and content. (The rejected write itself MUST NOT appear in `dependencies` — it was never committed to the graph, and referencing it would violate the no-dangling-references constraint of section 5.2.)

**Semantic extension (MAY) [v0.3]:** implementations MAY additionally pass writes through a semantic contradiction checker (e.g. an LLM comparing the incoming body against high-confidence nodes). This checker MUST be optional, off by default, and pluggable. The protocol does not require semantic detection for compliance.

---

## 9. agents.json

Every Mastishk memory folder MUST contain an `agents.json` file:

```json
{
  "version": "0.3",
  "conflict_strategy": "flag",
  "write_back": "required",
  "session_timeout_hours": 8,
  "registered_agents": [
    { "id": "claude-code", "access": "read-write", "trust": "high",
      "last_session_at": "2026-06-11T18:00:00Z" },
    { "id": "cursor", "access": "read-write", "trust": "high",
      "last_session_at": null },
    { "id": "custom-agent", "access": "read-write", "trust": "medium",
      "last_session_at": null }
  ]
}
```

- `conflict_strategy` MUST be one of `flag` (default, recommended), `human`, `latest`
- `last_session_at` **[v0.3]** is updated by `session end` and consumed by `catchup`
- `session_timeout_hours` **[v0.3]** controls stale-session expiry (section 15.3)
- Implementations SHOULD auto-register unknown writing agents with `trust: medium`

---

## 10. MCP tool interface

A Mastishk MCP server MUST expose the following tools. Tool descriptions are part of the protocol — they determine how agents discover and use them, and MUST be written so an agent encountering them for the first time understands when and how to call them.

| Tool | Description | Required params |
|---|---|---|
| `mastishk_inject` | Get structured memory context for a task | `task: string` |
| `mastishk_update` | Update or create a memory node | `id: string, content: string, layer: string` |
| `mastishk_log` | Append an issue or error to memory | `message: string, type?: string` |
| `mastishk_status` | Return memory health summary | none |
| `mastishk_checkpoint` | Commit current memory state to git | `message?: string` |
| `mastishk_session_start` **[v0.3]** | Begin a session: register presence, return catchup + inject | `agent: string, task: string` |
| `mastishk_session_end` **[v0.3]** | End a session: write handoff, deregister, checkpoint | `handoff: string` |
| `mastishk_catchup` **[v0.3]** | Summarise memory changes since this agent's last session | `agent: string` |

When the MCP server is running, it SHOULD act as the single writer for the memory folder (section 16.2).

> **[v0.3 — not yet in reference implementation]** The three session tools
> (`mastishk_session_start`, `mastishk_session_end`, `mastishk_catchup`) are
> specified but not yet exposed by the reference MCP server; the underlying
> operations are available through the CLI. Tracked as build phase 12.

---

## 11. CLI interface

A compliant CLI implementation MUST support:

```
mastishk init [--template <name>]
mastishk session start --agent <id> [--task <task>]     [v0.3]
mastishk session end [--handoff <text>]                 [v0.3]
mastishk catchup [--agent <id>]                         [v0.3]
mastishk next                                           [v0.3]
mastishk inject <task>
mastishk update <id> [--status <status>] [--confidence <float>]
mastishk log [--error] <message>
mastishk map [--stale] [--refresh <id>]                 [v0.3]
mastishk scan
mastishk status
mastishk doctor                                         [v0.3]
mastishk checkpoint [--message <msg>]
mastishk mcp [--port <port>]
mastishk instruct --agent <name>
mastishk hook
```

`mastishk init` MUST:
- Create the `.mastishk/` folder structure including `map/` and the `.gitignore` for `sessions/`
- Create `memory-map.json` with empty nodes and edges
- Create `agents.json` with default config
- Write the agent briefing into `AGENTS.md` (canonical) and mirror it into `CLAUDE.md` (section 14)
- Attempt to install a post-commit git hook (section 16)
- If the `intent/` layer is empty and a TTY is attached: run the interactive goal prompt (section 12.5)

`mastishk next` **[v0.3]** MUST print the first unblocked step of the most recently updated active `plan` node, or `No active plan.` if none exists.

`mastishk doctor` **[v0.3]** MUST validate the entire memory folder — node schema, layer/type pairing, graph constraints, ID uniqueness, expired nodes, stale map entries, stale sessions — and print actionable findings with a non-zero exit code if any MUST-level violation is found.

`mastishk scan` MUST:
- Read `package.json` (or equivalent manifest) and infer project name, stack, and dependencies as `knowledge` nodes with `confidence: 0.6` and `scanned: true`
- **[v0.3]** Walk significant source files and generate `map` nodes (`type: file`, `confidence: 0.6, scanned: true`) with a one-line purpose summary per file or module
- Read `git log --oneline` and convert recent commits to `state` nodes
- Read existing `README.md` and extract goals or constraints if present
- Prompt the user to confirm, edit, or skip each generated node

---

## 12. The instruct interface

### 12.1 Purpose

`mastishk instruct --agent <name>` generates an agent-specific briefing and, where applicable, writes the agent's configuration file. It is the recommended first step after `mastishk init` when onboarding an agent.

### 12.2 Supported agents

| Agent | Action |
|---|---|
| `claude-code` | Write or update the Mastishk section in `AGENTS.md` and `CLAUDE.md` (section 14) |
| `cursor` | Write or update `.cursor/mcp.json` with the MCP server config (section 12.3) |
| `windsurf` | Write or update `.windsurf/mcp.json` with the MCP server config (section 12.3) |
| `api` | Print the session-start output (catchup + inject) to stdout for piping into any agent |

### 12.3 MCP config format

For `cursor` and `windsurf`, the written config MUST follow this structure exactly:

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

### 12.4 Memory summary

After completing the agent-specific action, `instruct` MUST print:

```
Memory summary for this project:
─────────────────────────────────
Goals:    {first line of the primary goal node body}
Status:   {first line of the primary state task body}
Issues:   {count of active issue nodes}
Last session: {agent id} ({relative time})
─────────────────────────────────
This agent now has the same memory as every other agent on this project.
```

The "primary goal node" is the first node of type `goal` in the `intent` layer found in `memory-map.json`. The "primary state task node" is the first node of type `task` in the `state` layer. If either is absent, the field SHOULD display `N/A`.

### 12.5 Interactive goal prompt on init

When `mastishk init` detects that the `intent/` layer is empty and a TTY is attached, it SHOULD run an interactive prompt:

1. What are you building? (required)
2. What is the main goal? (required)
3. Target date or milestone? (optional)
4. Hard constraints — stack, budget, things to avoid? (optional)
5. What resources do you have — datasets, APIs, compute, budget? (optional) **[v0.3]**
6. Current status? (optional; defaults to "Fresh project — nothing built yet.")

From the answers, `mastishk init` MUST create:

- `intent/goal-main.msk.md` — `type: goal`, `confidence: 1.0`, `created_by: human`, body from answers 1–3
- `intent/constraints-main.msk.md` — `type: constraint` (only if answer 4 provided)
- `intent/resources-main.msk.md` — `type: resource` (only if answer 5 provided) **[v0.3]**
- `state/progress-initial.msk.md` — `type: task`, body from answer 6

All created nodes MUST be registered in `memory-map.json`.

---

## 13. *(merged into section 7 — Git as episodic memory)*

---

## 14. Agent onboarding — AGENTS.md and CLAUDE.md

### 14.1 Purpose

When Mastishk is initialised, it injects a workflow briefing into the project's agent instruction files so that any agent opening the project discovers the shared memory without configuration. **`AGENTS.md` is the canonical location** (the cross-agent instruction file adopted by the wider ecosystem); `CLAUDE.md` receives a mirror of the same section for Claude Code.

### 14.2 Detection and injection rules

> **[v0.3 — not yet in reference implementation]** The reference implementation
> currently writes `CLAUDE.md` only. Making `AGENTS.md` the canonical target is
> tracked as build phase 12.

For each of `AGENTS.md` and `CLAUDE.md`, a compliant implementation MUST:

- If the file exists and does not contain `## Mastishk memory`: append the section at the end
- If the file does not exist: create it with the section as its sole content
- If the file already contains `## Mastishk memory`: leave it unchanged on `init`; `instruct` MAY replace it with the current canonical format

### 14.3 Section format

The injected section MUST contain at minimum: a `## Mastishk memory` heading, the session-start instruction, a description of the memory layers, and end-of-session instructions. Canonical format:

```markdown
## Mastishk memory

This project uses Mastishk for persistent shared agent memory.
Memory lives in `.mastishk/` — do not edit these files manually.
Multiple agents work on this project. Mastishk is the single brain they share.

**At the start of every session — do this first, before anything else:**
Run `mastishk session start --agent <your-agent-id> --task "<task>"`.
Read the full output: it contains the handoff from the previous session,
what changed since you were last here, goals, current state, constraints,
the codebase map, and open issues. Do not start work until you have read it.

**During the session:**
- If you complete a task: update its status in `state/`
- If you hit an error: log it with `mastishk log`
- If you learn something about the architecture: add it to `knowledge/`
- If a `map/` entry you rely on is marked (stale): verify it against the code and refresh it

**At the end of every session:**
Run `mastishk session end` and write a handoff covering:
Done / In flight / Watch out / Next.

**Memory layers:**
- `.mastishk/intent/` — goals, constraints, resources. Never modify without human confirmation.
- `.mastishk/state/` — tasks, plans, progress, handoffs. Update freely (append-only).
- `.mastishk/knowledge/` — architecture and decisions. Add as you learn.
- `.mastishk/map/` — which file does what. Keep fresh; trust is everything here.
- `.mastishk/issues/` — errors and blockers. Always log, never delete.
```

---

## 15. The session protocol

The session protocol is what makes the memory *shared* rather than merely co-located. Its lifecycle: **check in → catch up → work → hand off**.

### 15.1 Session start

`mastishk session start --agent <id> --task <task>` MUST:

1. Register the session in `.mastishk/sessions/active.json`: `{ agent, task, started_at }`
2. If other unexpired sessions are active, print a presence warning naming each active agent and its task
3. Print the catchup output for this agent (section 15.4)
4. Print the inject output for the given task (section 6)
5. Update nothing else — session start is a read operation plus presence registration

### 15.2 Session end

`mastishk session end [--handoff <text>]` MUST:

1. Create a `handoff` node in `state/` (section 4.2). If `--handoff` is not provided and a TTY is attached, prompt for the four sections (Done / In flight / Watch out / Next); a non-interactive call without `--handoff` MUST still deregister but SHOULD warn that no handoff was written
2. Set `last_session_at` for the agent in `agents.json`
3. Remove the session from `sessions/active.json`
4. Run `mastishk checkpoint`

### 15.3 Stale sessions

A session whose `started_at` is older than `session_timeout_hours` (default 8) MUST be treated as expired: silently removed from the registry, never blocking another agent. Crashed agents therefore cost nothing.

### 15.4 Catchup

`mastishk catchup --agent <id>` MUST summarise what changed since the agent's `last_session_at` (or since memory creation if null), computed from the git history of `.mastishk/` and node timestamps. The output MUST be ordered:

1. Most recent active handoff (full body)
2. Tasks resolved since last session
3. New or updated issues
4. Knowledge nodes added or changed
5. Map nodes flagged stale
6. Next unblocked plan step, if an active plan exists

The output SHOULD fit in 2,000 characters. Catchup is the first thing an agent reads; implementations MUST keep it short and MUST NOT pad it.

---

## 16. Ambient capture  [hook portions implemented; map staleness v0.3]

Ambient capture keeps memory current without depending on agent or developer discipline. It is the protocol's defence against memory rot.

### 16.1 Post-commit hook

`mastishk init` MUST attempt to install a post-commit hook that runs `npx @mastishk/cli hook`. Installation rules:

- The hook MUST be installed to the directory git actually uses — `core.hooksPath` if configured, else `.git/hooks/`
- If a `post-commit` hook already exists, the Mastishk line MUST be appended, never overwritten
- The hook file MUST be made executable (mode 0755 on POSIX); if no git repository exists, installation MUST be skipped silently

When `mastishk hook` runs, it MUST:

1. Verify `.mastishk/` exists; exit silently if not
2. Read the latest commit message via `git log -1 --pretty=%s`
3. Classify by prefix: `feat:`/`add:` → "Completed: {message}", `fix:` → "Fixed: {message}", `wip:` → "In progress: {message}" — appended to the primary state task node per the append-only contract. Other prefixes: no state write
4. **[v0.3]** Read the commit's changed paths via `git log -1 --name-only` and set `stale: true` on every `map` node whose `path` matches a changed file (section 4.4)
5. Update `memory-map.json` with a new `updated_at` timestamp

The "primary state task node" is the first node of `type: task` in the `state` layer in `memory-map.json`; if none exists, one MUST be created at `state/progress.msk.md` with `id: progress`.

### 16.2 Agent tool use

When agents call MCP tools (section 10), memory is read and written as a natural part of task execution. When the MCP server is running it SHOULD serialise all writes through itself (single-writer mode), which makes the concurrency rules in section 17 trivially satisfied for MCP-connected agents.

---

## 17. Concurrency and trust

### 17.1 Atomic writes

All file writes under `.mastishk/` MUST be atomic: write to a temporary file in the same directory, then rename. A reader MUST never observe a half-written node.

### 17.2 Locking

Updates to `memory-map.json` MUST be guarded by a lock file at `.mastishk/.lock` containing the holder's agent ID and timestamp. A lock older than 30 seconds MAY be broken. Because state nodes are append-only and nodes are fine-grained files, genuine same-node write conflicts are structurally rare; when they occur, the Referee's `conflict_strategy` applies.

### 17.3 Trust enforcement

The `trust` field in `agents.json` MUST be enforced at write time:

| Trust | Enforcement |
|---|---|
| `high` | No restrictions beyond the Referee |
| `medium` | Writes capped at `confidence: 0.6`; `intent/` writes require human confirmation |
| `low` | As medium, plus `knowledge/` and `map/` writes land as `status: draft` until confirmed by a high-trust agent or human |

An agent with `access: read-only` MUST be refused all writes.

---

## 18. Compliance

A Mastishk-compliant implementation is one that passes all tests in the compliance suite at `tests/compliance/`.

The compliance suite tests:

- Node format, layer/type pairing, ID uniqueness (section 3)
- Layer semantics including plans, handoffs, and map staleness (section 4)
- Graph constraints (section 5)
- Inject output format and budget (section 6)
- Write-back contract, append-only behaviour, and the deterministic Referee (section 8)
- MCP tool presence and description format (section 10)
- CLI command availability, `next` plan-step selection, and `doctor` findings (section 11)
- Session lifecycle and catchup output ordering (section 15)
- Ambient capture including map staleness flagging (section 16)
- Atomic writes, locking, and trust enforcement (section 17)

Implementations in any language that pass the compliance suite MAY list themselves as Mastishk-compliant at `mastishk.dev/implementations`.

---

## Changelog

| Version | Date | Notes |
|---|---|---|
| 0.1 | 2026-05-12 | Initial draft — prior art publication |
| 0.2 | 2026-05-12 | Added instruct interface, interactive goal prompt, ambient capture via git hooks, CLAUDE.md integration |
| 0.3 | 2026-06-12 | Restructured around two core claims (project-owned shared memory; structure-aware injection). Added: session protocol (§15 — session start/end, presence, stale sessions, catchup), handoff and plan node types (§4.2), `map/` codebase map store with staleness contract (§4.4), `resource` node type (§4.1), concurrency and trust enforcement (§17), `mastishk next`/`doctor`/`catchup`/`session`/`map` CLI commands (§11), three new MCP tools (§10), AGENTS.md as canonical onboarding file (§14). Referee redefined with a mandatory deterministic core and optional semantic extension (§8.3). Inject seeding made pluggable, budget redefined in characters, handoff surfaced first (§6). Knowledge version history defined as git history (§4.3). ID uniqueness defined testably (§3.1). Fixed stale `cmg scan` reference and org name. |
| 0.3 | 2026-08-10 | No normative change. Implementation-status update: §8.3 (Referee), §17 (concurrency and trust) and §15 (session protocol, incl. catchup and handoff nodes) are now implemented and covered by compliance suites 08 and 09; their "not yet in reference implementation" markers are removed. Still unimplemented: §4.4 `map/` staleness, plan nodes, `next`, `doctor` (§11), AGENTS.md canonical onboarding (§14), the three v0.3 MCP tools (§10). Known deviation: §15.4 catchup is computed from node timestamps only, not git history — recorded as a SPEC-GAP in `catchup.ts`. |
| 0.3 | 2026-08-10 | No normative change. Implementation-status update: §4.4 (`map/` store and staleness contract), §16.1 step 4 (commit-driven staleness flagging), and §11 `next` / `map` / `doctor` are now implemented and covered by compliance suites 10 and 11. `memory-map.json` entries gained cached `path` and `stale` fields so ambient capture can match changed paths without opening every node file (§5.1 — additive, existing indexes remain valid). Remaining v0.3 gaps: AGENTS.md canonical onboarding (§14.2) and the three session MCP tools (§10), both now explicitly marked. |
