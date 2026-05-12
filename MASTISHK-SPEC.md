# MASTISHK-SPEC.md
# Mastishk Protocol Specification
# Version 0.2 — Draft

**Authors:** Mastishk Protocol Contributors  
**Organisation:** github.com/mastishk  
**Published:** 2026-05-12  
**License:** Apache 2.0  
**Status:** Draft — seeking community review  

---

## Abstract

Mastishk is an open protocol for persistent, structured, filesystem-native memory for AI coding agents. It defines a three-layer memory architecture stored as markdown files with YAML frontmatter, organised as a directed acyclic graph (DAG), and versioned through git. Any compliant implementation enables AI agents — regardless of vendor, framework, or interface — to share coherent project memory across sessions, tools, and teams.

---

## 1. Motivation

Current AI coding agents are stateless by default. Each session starts with no knowledge of prior decisions, errors, architecture choices, or goals. The existing workarounds — stuffing context into system prompts, vector databases, proprietary memory layers — share three failure modes:

- **Token inefficiency** — full context injection scales poorly with project size
- **Vendor lock-in** — memory stored in one agent's system is inaccessible to others
- **No causal structure** — similarity-based retrieval cannot represent goal→task→constraint relationships

Mastishk addresses all three by treating project memory as a structured, human-readable, git-backed graph that any agent can read from and write to.

---

## 2. Definitions

- **Node** — a single `.msk.md` file representing one unit of memory
- **Layer** — a semantic category of memory: `intent`, `state`, or `knowledge`
- **Graph** — the DAG formed by dependency links between nodes, indexed in `memory-map.json`
- **Inject** — the operation that traverses the graph and returns a context string for an agent prompt
- **Referee** — the validation layer that checks new writes for contradictions before committing
- **Compliance** — an implementation passes all tests in `tests/compliance/`

The keywords MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY in this document follow RFC 2119.

---

## 3. Node format

### 3.1 File naming

Every memory node MUST be stored as a file with the `.msk.md` extension.

Files MUST follow this naming convention:
```
{layer}/{id}.msk.md
```

Where `{layer}` is one of `intent`, `state`, `knowledge`, or `issues`, and `{id}` is a kebab-case string unique within the project memory.

### 3.2 YAML frontmatter

Every `.msk.md` file MUST begin with a YAML frontmatter block delimited by `---`. The following fields are required:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier, kebab-case, matches filename |
| `type` | enum | One of: `goal`, `task`, `decision`, `constraint`, `issue`, `fact` |
| `layer` | enum | One of: `intent`, `state`, `knowledge`, `issues` |
| `status` | enum | One of: `active`, `resolved`, `deprecated`, `draft` |
| `confidence` | float | 0.0–1.0. Human-set = 1.0. Agent-inferred = 0.6. Unverified = 0.3 |
| `created_by` | string | Agent ID or `human` |
| `created_at` | ISO 8601 | Creation timestamp |
| `last_updated_by` | string | Agent ID or `human` |
| `last_updated_at` | ISO 8601 | Last update timestamp |
| `dependencies` | string[] | IDs of nodes this node depends on |
| `contradictions` | string[] | IDs of nodes this node contradicts |

The following fields are optional:

| Field | Type | Description |
|---|---|---|
| `tags` | string[] | Free-form tags for search |
| `scanned` | boolean | `true` if created by `cmg scan`, not by human or explicit agent |
| `verified` | boolean | `true` if a human has confirmed this node's content |
| `expires_at` | ISO 8601 | After this date, node SHOULD be flagged for review |

### 3.3 Body content

The body following the YAML frontmatter MUST be valid markdown. It SHOULD be concise — one to five sentences for most nodes. Long-form content SHOULD be linked to external files, not embedded.

### 3.4 Example node

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

The `intent` layer holds long-term goals, objectives, and constraints. It changes rarely and has the highest persistence.

- Nodes in this layer MUST have `type` of `goal` or `constraint`
- Agents MUST NOT modify `intent` nodes without explicit human confirmation
- A compliant implementation SHOULD warn before any agent write to this layer

### 4.2 state/

The `state` layer holds current tasks, progress, blockers, and outcomes. It changes frequently.

- Nodes in this layer MUST have `type` of `task` or `issue` (when tracked here rather than `issues/`)
- State writes MUST be append-only — existing content is never overwritten, only new content appended with a timestamp
- A resolved task MUST update `status: resolved` and `last_updated_*` fields

### 4.3 knowledge/

The `knowledge` layer holds architecture decisions, technical facts, stack choices, and accumulated understanding. It grows over time.

- Nodes in this layer MUST have `type` of `decision` or `fact`
- Knowledge writes MAY replace the body content, but MUST preserve the full frontmatter history
- High-confidence knowledge nodes (`confidence >= 0.8`) MAY be treated as constraints by the Referee

### 4.4 issues/

The `issues/` layer is a dedicated log for errors, bugs, and blockers.

- Every issue node MUST have `type: issue`
- Issues MUST be append-only — never deleted, only resolved via `status: resolved`
- An unresolved issue with `expires_at` in the past MUST be surfaced by `mastishk status`

---

## 5. The graph

### 5.1 memory-map.json

Every Mastishk memory folder MUST contain a `memory-map.json` file at its root. This file is the graph index. It MUST be updated on every node write.

Required structure:

```json
{
  "version": "0.1",
  "updated_at": "2026-05-12T00:00:00Z",
  "nodes": {
    "goal-launch-v1": {
      "file": "intent/goal-launch-v1.msk.md",
      "layer": "intent",
      "type": "goal",
      "status": "active",
      "confidence": 1.0,
      "dependencies": [],
      "tags": ["launch", "v1"]
    }
  },
  "edges": [
    { "from": "task-write-spec", "to": "goal-launch-v1", "relation": "serves" }
  ]
}
```

### 5.2 Graph constraints

A compliant implementation MUST enforce:

- No cycles — the dependency graph MUST be a DAG
- No dangling references — every ID in `dependencies` or `contradictions` MUST correspond to a node in `memory-map.json`
- Unique IDs — no two nodes may share an ID within a project

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

`inject(task)` is the primary interface between Mastishk and an agent. It accepts a natural language task description and returns a formatted context string ready for use in an agent system prompt.

### 6.2 Algorithm

A compliant `inject` implementation MUST:

1. Tokenise the task string and match against node `id`, `tags`, and body content
2. Select seed nodes from matches, ranked by confidence descending
3. Traverse the graph from seeds at depth 2
4. Filter to `status: active` nodes with `confidence >= 0.5`
5. Sort results: `intent` layer first, then `state`, then `knowledge`
6. Format output per section 6.3
7. Enforce a 2000-token output budget — truncate by dropping lowest-confidence nodes first

### 6.3 Output format

The inject output MUST follow this structure exactly:

```
## Mastishk context — {task}
Generated: {ISO timestamp}

### Goals
{intent layer nodes}

### Current state
{state layer nodes}

### Knowledge
{knowledge layer nodes}

### Open issues
{issues layer nodes with status: active}
```

Each node in the output MUST render as:
```
**{id}** [{confidence}] — {body first sentence}
```

A compliant implementation MUST NOT include node body content beyond the first sentence in inject output, unless the node has `confidence >= 0.9`.

---

## 7. The write-back contract

### 7.1 Agent writes

Any agent performing a write MUST:

1. Provide its agent ID in `last_updated_by`
2. Update `last_updated_at` to the current timestamp
3. Pass the new node through the Referee before committing

### 7.2 Append-only for state

For nodes in the `state` layer, a compliant implementation MUST append new content below existing content, separated by a timestamp header:

```markdown
### 2026-05-12T10:30:00Z — claude-code

Completed JWT implementation. Refresh token rotation working.
```

### 7.3 Conflict detection

The Referee MUST check every incoming write against:

- Existing nodes in `contradictions` field
- Any node whose body content semantically contradicts the incoming write (confidence-weighted)

If a contradiction is detected, the write MUST be rejected and a conflict node created in `issues/` with:

```yaml
type: issue
tags: [conflict, referee]
```

The conflict node MUST reference both the incoming write and the contradicting node.

---

## 8. agents.json

Every Mastishk memory folder SHOULD contain an `agents.json` file:

```json
{
  "version": "0.1",
  "conflict_strategy": "flag",
  "write_back": "required",
  "registered_agents": [
    { "id": "claude-code", "access": "read-write", "trust": "high" },
    { "id": "cursor", "access": "read-write", "trust": "high" },
    { "id": "custom-agent", "access": "read-write", "trust": "medium" }
  ]
}
```

`conflict_strategy` MUST be one of:
- `flag` — create a conflict issue and halt (default, recommended)
- `human` — pause and require human resolution
- `latest` — accept the latest write (lowest safety, not recommended)

---

## 9. MCP tool interface

A Mastishk MCP server MUST expose the following tools. Tool descriptions are part of the protocol — they determine how agents discover and use them.

| Tool | Description | Required params |
|---|---|---|
| `mastishk_inject` | Get structured memory context for a task | `task: string` |
| `mastishk_update` | Update or create a memory node | `id: string, content: string, layer: string` |
| `mastishk_log` | Append an issue or error to memory | `message: string, type?: string` |
| `mastishk_status` | Return memory health summary | none |
| `mastishk_checkpoint` | Commit current memory state to git | `message?: string` |

Tool descriptions in the MCP server MUST be written so that an agent encountering them for the first time will understand when and how to call them without additional instruction.

---

## 10. CLI interface

A compliant CLI implementation MUST support:

```
mastishk init [--template <name>]
mastishk inject <task>
mastishk update <id> [--status <status>] [--confidence <float>]
mastishk log [--error] <message>
mastishk scan
mastishk status
mastishk checkpoint [--message <msg>]
mastishk mcp [--port <port>]
mastishk instruct --agent <name>
mastishk hook
```

`mastishk init` MUST:
- Create the `.mastishk/` folder structure
- Create `memory-map.json` with empty nodes and edges
- Create `agents.json` with default config
- If `CLAUDE.md` exists in the project root and has no Mastishk section: append one (section 13)
- If `CLAUDE.md` does not exist: create it with the Mastishk section as its sole content (section 13)
- Attempt to install a post-commit git hook at `.git/hooks/post-commit` (section 12)
- If the `intent/` layer is empty and a TTY is attached: run the interactive goal prompt (section 11.5)

`mastishk scan` MUST:
- Read `package.json` and infer project name, stack, and dependencies as `knowledge` nodes with `confidence: 0.6` and `scanned: true`
- Read `git log --oneline` and convert commits to `state` nodes
- Read existing `README.md` and extract goals or constraints if present
- Prompt the user to confirm, edit, or skip each generated node

---

## 11. The instruct interface

### 11.1 Purpose

`mastishk instruct --agent <name>` generates an agent-specific briefing and, where applicable, writes the agent's configuration file so the agent has immediate access to project memory. It is the recommended first step after `mastishk init` when onboarding an agent to an existing project.

### 11.2 Supported agents

A compliant `instruct` implementation MUST support the following agent names:

| Agent | Action |
|---|---|
| `claude-code` | Write or update the Mastishk section in `CLAUDE.md` in the project root (section 13) |
| `cursor` | Write or update `.cursor/mcp.json` with the MCP server config (section 11.3) |
| `windsurf` | Write or update `.windsurf/mcp.json` with the MCP server config (section 11.3) |
| `api` | Print the full inject output for `"current task"` to stdout |

### 11.3 MCP config format

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

The file MUST be valid JSON and MUST be written to the agent's config directory relative to the project root.

### 11.4 Memory summary

After completing the agent-specific action, `instruct` MUST print a memory summary in this format:

```
Memory summary for this project:
─────────────────────────────────
Goals:    {first line of the primary goal node body}
Status:   {first line of the primary state task body}
Issues:   {count of active issue nodes}
Last updated by: {last_updated_by} ({relative time})
─────────────────────────────────
This agent now has the same memory as every other agent on this project.
```

The "primary goal node" is the first node of type `goal` in the `intent` layer found in `memory-map.json`. The "primary state task node" is the first node of type `task` in the `state` layer. If either is absent, the field SHOULD display `N/A`.

### 11.5 Interactive goal prompt on init

When `mastishk init` detects that the `intent/` layer is empty and a TTY is attached, it SHOULD run an interactive prompt to seed the project's memory with human-provided goals. The prompt MUST ask:

1. What are you building? (required)
2. What is the main goal? (required)
3. Target date or milestone? (optional)
4. Hard constraints — stack, budget, things to avoid? (optional)
5. Current status? (optional; defaults to "Fresh project — nothing built yet.")

From the answers, `mastishk init` MUST create:

- `intent/goal-main.msk.md` — `type: goal`, `confidence: 1.0`, `created_by: human`, body from answers 1–3
- `intent/constraints-main.msk.md` — `type: constraint`, `confidence: 1.0`, `created_by: human`, body from answer 4 (only if provided)
- `state/progress-initial.msk.md` — `type: task`, `confidence: 1.0`, `created_by: human`, body from answer 5

All three MUST be registered in `memory-map.json`.

---

## 12. Ambient capture via git hooks

### 12.1 Purpose

Ambient capture keeps memory current without manual developer intervention. It is achieved through a post-commit git hook installed automatically by `mastishk init`.

### 12.2 Hook installation

`mastishk init` MUST attempt to install a post-commit hook at `.git/hooks/post-commit` with this content:

```sh
#!/bin/sh
npx @mastishk/cli hook
```

The hook file MUST be made executable (mode 0755 on POSIX systems). If no `.git/` directory exists in the project root, installation MUST be skipped silently with no error.

### 12.3 Hook behaviour

When `mastishk hook` is invoked, it MUST:

1. Verify `.mastishk/` exists; exit silently if not
2. Read the latest commit message via `git log -1 --pretty=%s`
3. Classify the commit based on its prefix:
   - `feat:` or `add:` → append body `"Completed: {message}"` to the primary state task node
   - `fix:` → append body `"Fixed: {message}"` to the primary state task node
   - `wip:` → append body `"In progress: {message}"` to the primary state task node
4. If the commit prefix does not match any of the above, exit silently
5. Append to the primary state task node following the append-only contract (section 7.2)
6. Update `memory-map.json` with a new `updated_at` timestamp

The "primary state task node" is the first node of `type: task` in the `state` layer found in `memory-map.json`. If no such node exists, a new node MUST be created at `state/progress.msk.md` with `id: progress`.

---

## 13. CLAUDE.md integration

### 13.1 Purpose

When Mastishk is initialised in a project that uses Claude Code, it injects a structured workflow briefing into `CLAUDE.md`. This ensures Claude Code automatically reads memory context at the start of every session without additional configuration.

### 13.2 Detection and injection rules

A compliant implementation MUST apply the following rules:

- If `CLAUDE.md` exists and does not contain `## Mastishk memory`: append the section (section 13.3) at the end of the file
- If `CLAUDE.md` does not exist: create it with the section (section 13.3) as its sole content
- If `CLAUDE.md` already contains `## Mastishk memory`: leave it unchanged on `init`; `instruct --agent claude-code` MAY replace it with the current canonical format

### 13.3 Section format

The injected Mastishk section MUST contain at minimum:

- A `## Mastishk memory` heading
- An instruction to run `mastishk inject "<task>"` at session start
- A description of the four memory layers and their update rules
- Instructions for end-of-session memory maintenance

The canonical format used by the reference implementation is:

```markdown
## Mastishk memory

This project uses Mastishk for persistent agent memory.
Memory lives in `.mastishk/` — do not edit these files manually.

**At the start of every session — do this first, before anything else:**
Run `mastishk inject "<task>"` and read the full output.
It contains your goals, current state, constraints, and open issues.
Do not start work until you have read it.

**During the session:**
- If you complete a task: update its status in `state/`
- If you hit an error: log it with `mastishk log`
- If you learn something about the architecture: add it to `knowledge/`

**At the end of every session:**
- Update `.mastishk/state/progress.msk.md` with what was done
- Run `mastishk checkpoint` to commit memory state to git

**Memory layers:**
- `.mastishk/intent/` — goals and constraints. Never modify without human confirmation.
- `.mastishk/state/` — current tasks and progress. Update freely.
- `.mastishk/knowledge/` — architecture and decisions. Add as you learn.
- `.mastishk/issues/` — errors and blockers. Always log, never delete.
```

---

## 14. Compliance

A Mastishk-compliant implementation is one that passes all tests in the compliance suite at `tests/compliance/`.

The compliance suite tests:

- Valid and invalid node format (section 3)
- Layer semantics enforcement (section 4)
- Graph constraint violations (section 5)
- Inject output format (section 6)
- Write-back contract and append-only behaviour (section 7)
- Conflict detection and Referee behaviour (section 7.3)
- MCP tool presence and description format (section 9)
- CLI command availability (section 10)

Implementations in any language that pass the compliance suite MAY list themselves as Mastishk-compliant at `mastishk.dev/implementations`.

---

## Changelog

| Version | Date | Notes |
|---|---|---|
| 0.1 | 2026-05-12 | Initial draft — prior art publication |
| 0.2 | 2026-05-12 | Added sections 11 (instruct interface + interactive goal prompt), 12 (ambient capture via git hooks), 13 (CLAUDE.md integration). Compliance moved to section 14. Section 10 updated with `instruct` and `hook` CLI commands and expanded `init` requirements. |
