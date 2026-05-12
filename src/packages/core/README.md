# @mastishk/core

Core library for the [Mastishk protocol](https://mastishk.dev) — schema, validation, read, write, graph, traversal, and context injection for persistent AI agent memory.

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

## Protocol

- Spec: [MASTISHK-SPEC.md](https://github.com/mastishk-ai/mastishk/blob/main/MASTISHK-SPEC.md)
- Website: [mastishk.dev](https://mastishk.dev)
- License: Apache 2.0
