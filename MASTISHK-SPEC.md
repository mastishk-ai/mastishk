# MASTISHK-SPEC.md
# Mastishk Protocol Specification
# Version 0.1 — Draft

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
```

`mastishk init` MUST:
- Create the `.mastishk/` folder structure
- Create `memory-map.json` with empty nodes and edges
- Create `agents.json` with default config
- Append a Mastishk section to `CLAUDE.md` if one exists in the project root

`mastishk scan` MUST:
- Read `package.json` and infer project name, stack, and dependencies as `knowledge` nodes with `confidence: 0.6` and `scanned: true`
- Read `git log --oneline` and convert commits to `state` nodes
- Read existing `README.md` and extract goals or constraints if present
- Prompt the user to confirm, edit, or skip each generated node

---

## 11. Compliance

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
