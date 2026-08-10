# @mastishk/core

Core library for the [Mastishk protocol](https://mastishk.dev) — schema, validation, read,
write, graph, traversal, and context injection for persistent, shared AI agent memory.

Implements protocol spec **v0.3**. No CLI or MCP dependencies.

## Install

```bash
npm install @mastishk/core
```

## Usage

```typescript
import { readNode, writeNode, inject, readMemoryMap } from '@mastishk/core';

// Read a memory node
const node = await readNode('.mastishk/intent/goal-launch-v1.msk.md');

// Write a new node
await writeNode('.mastishk/state/task-build-auth.msk.md', {
  id: 'task-build-auth',
  type: 'task',
  layer: 'state',
  status: 'active',
  confidence: 1.0,
  created_by: 'claude-code',
  created_at: new Date().toISOString(),
  last_updated_by: 'claude-code',
  last_updated_at: new Date().toISOString(),
  dependencies: ['goal-launch-v1'],
  contradictions: [],
  body: 'Implement JWT authentication.',
});

// Get inject context for a task
const context = await inject('build authentication', '.mastishk');
// Returns formatted context string ready for an agent system prompt
```

## API

### `readNode(filePath): Promise<MskNode>`
Parse a `.msk.md` file into a validated `MskNode`. Throws `MskReadError` if invalid.

### `writeNode(filePath, node): Promise<void>`
Write a node to disk. State-layer writes are append-only with timestamp headers. Throws `MskWriteError` if validation fails.

### `inject(task, mastishkDir): Promise<string>`
Tokenise the task, match against node IDs and tags, traverse the DAG at depth 2, and return a formatted context string per spec section 6.3.

### `validate(node): { valid: boolean; errors: string[] }`
Validate any object against the `MskNodeSchema`.

### `readMemoryMap(filePath) / writeMemoryMap(filePath, map)`
Read/write the `memory-map.json` DAG index.

### `upsertNode(map, id, entry): MemoryMap`
Add or update a node in the memory map and rebuild edges.

### `traverse(map, seedIds, options): TraversalResult[]`
DFS traversal from seed nodes following dependency edges.

### `validateGraph(map) / assertValidGraph(map)`
Check for cycles, dangling references, and duplicate IDs.

### `commitNode(mastishkDir, node): Promise<CommitResult>`
The canonical write path: trust enforcement → Referee → atomic node write → index update.
Prefer this over `writeNode` for anything an agent writes. Returns why a write was rejected
rather than throwing.

### `referee(map, incoming, strategy): RefereeDecision`
The deterministic conflict core (spec §8.3). A write that contradicts an existing active node
is rejected and logged as a conflict issue, or accepted with the contradicted node deprecated,
depending on `conflict_strategy`. Never a silent overwrite.

### `enforceTrust(config, node): TrustDecision`
Trust enforcement at write time (spec §17.3): confidence caps, `intent/` gating, draft-gating
for low-trust agents, and refusal for read-only agents.

### `acquireLock(mastishkDir, agentId, options): Promise<() => Promise<void>>`
The `.mastishk/.lock` guard for `memory-map.json` updates. Locks older than 30s are breakable,
so a crashed writer never wedges the folder.

### Session protocol (spec §15)

#### `sessionStart(mastishkDir, agent, task): Promise<SessionStartResult>`
Register presence and return `{ presence, catchup, context }`. A read plus registration —
it writes no memory nodes.

#### `sessionEnd(mastishkDir, agent, options): Promise<SessionEndResult>`
Write a handoff node, set `last_session_at`, and deregister.

#### `catchup(mastishkDir, agent): Promise<string>`
What changed since that agent's last session, in protocol-defined order: handoff, resolved
tasks, issues, knowledge, stale map entries, next plan step.

### Codebase map (spec §4.4)

#### `readMapEntries(mastishkDir): Promise<MapEntry[]>`
#### `markStaleByPaths(mastishkDir, changedPaths, agent): Promise<StaleResult>`
Flag every map node covering one of the changed paths. Matching respects path-segment
boundaries, so `src/auth` covers `src/auth/token.ts` but never `src/authz/policy.ts`.
#### `refreshMapNode(mastishkDir, id, agent): Promise<boolean>`
#### `makeMapNode(id, path, body, overrides): MskNode`

### `doctor(mastishkDir): Promise<DoctorReport>`
Lint the whole memory folder. Returns findings split into MUST-level `violation`s and
`warning`s, plus an `ok` flag suitable for driving a CI exit code.

## Protocol

- Spec: [MASTISHK-SPEC.md](https://github.com/mastishk-ai/mastishk/blob/master/MASTISHK-SPEC.md)
- Website: [mastishk.dev](https://mastishk.dev)
- License: Apache 2.0
