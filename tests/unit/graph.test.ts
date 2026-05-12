import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createEmptyMemoryMap,
  readMemoryMap,
  writeMemoryMap,
  validateGraph,
  assertValidGraph,
  upsertNode,
  removeNode,
  MskGraphError,
} from '@mastishk/core';
import type { MemoryMap, MemoryMapNode } from '@mastishk/core';

const goalNode: MemoryMapNode = {
  file: 'intent/goal-launch-v1.msk.md',
  layer: 'intent',
  type: 'goal',
  status: 'active',
  confidence: 1.0,
  dependencies: [],
  tags: ['launch', 'v1'],
};

const taskNode: MemoryMapNode = {
  file: 'state/task-write-spec.msk.md',
  layer: 'state',
  type: 'task',
  status: 'active',
  confidence: 0.8,
  dependencies: ['goal-launch-v1'],
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-graph-'));
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// createEmptyMemoryMap
// ---------------------------------------------------------------------------

describe('createEmptyMemoryMap', () => {
  it('returns a map with empty nodes and edges', () => {
    const map = createEmptyMemoryMap();
    expect(map.version).toBe('0.1');
    expect(map.nodes).toEqual({});
    expect(map.edges).toEqual([]);
    expect(map.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// readMemoryMap / writeMemoryMap
// ---------------------------------------------------------------------------

describe('writeMemoryMap / readMemoryMap', () => {
  it('round-trips an empty map', async () => {
    const map = createEmptyMemoryMap();
    const filePath = join(tmpDir, 'memory-map.json');
    await writeMemoryMap(filePath, map);
    const read = await readMemoryMap(filePath);
    expect(read.version).toBe('0.1');
    expect(read.nodes).toEqual({});
    expect(read.edges).toEqual([]);
  });

  it('round-trips a map with nodes and edges', async () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'goal-launch-v1', goalNode);
    map = upsertNode(map, 'task-write-spec', taskNode);
    const filePath = join(tmpDir, 'memory-map.json');
    await writeMemoryMap(filePath, map);
    const read = await readMemoryMap(filePath);
    expect(read.nodes['goal-launch-v1']).toEqual(goalNode);
    expect(read.nodes['task-write-spec']).toEqual(taskNode);
    expect(read.edges).toHaveLength(1);
    expect(read.edges[0]).toEqual({ from: 'task-write-spec', to: 'goal-launch-v1', relation: 'depends-on' });
  });

  it('writeMemoryMap creates parent directories', async () => {
    const filePath = join(tmpDir, 'deep', 'nested', 'memory-map.json');
    await expect(writeMemoryMap(filePath, createEmptyMemoryMap())).resolves.not.toThrow();
    const read = await readMemoryMap(filePath);
    expect(read.version).toBe('0.1');
  });

  it('writeMemoryMap updates updated_at timestamp', async () => {
    const map = createEmptyMemoryMap();
    const before = new Date();
    const filePath = join(tmpDir, 'memory-map.json');
    await writeMemoryMap(filePath, map);
    const read = await readMemoryMap(filePath);
    expect(new Date(read.updated_at).getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('readMemoryMap throws when file does not exist', async () => {
    await expect(readMemoryMap(join(tmpDir, 'missing.json'))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateGraph — spec section 5.2
// ---------------------------------------------------------------------------

describe('validateGraph — valid maps', () => {
  it('empty map is valid', () => {
    expect(validateGraph(createEmptyMemoryMap()).valid).toBe(true);
  });

  it('single node with no deps is valid', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'goal-launch-v1', goalNode);
    expect(validateGraph(map).valid).toBe(true);
  });

  it('two nodes with valid dependency is valid', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'goal-launch-v1', goalNode);
    map = upsertNode(map, 'task-write-spec', taskNode);
    expect(validateGraph(map).valid).toBe(true);
  });

  it('chain A → B → C with no cycle is valid', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'a', { ...goalNode, dependencies: [] });
    map = upsertNode(map, 'b', { ...goalNode, dependencies: ['a'] });
    map = upsertNode(map, 'c', { ...goalNode, dependencies: ['b'] });
    expect(validateGraph(map).valid).toBe(true);
  });
});

describe('validateGraph — cycle detection (spec section 5.2)', () => {
  it('detects direct self-loop A → A', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'a', { ...goalNode, dependencies: ['a'] });
    const result = validateGraph(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('cycle'))).toBe(true);
  });

  it('detects two-node cycle A → B → A', () => {
    let map = createEmptyMemoryMap();
    // Manually build nodes with a cycle — bypass upsert so both exist
    map = {
      ...map,
      nodes: {
        a: { ...goalNode, dependencies: ['b'] },
        b: { ...goalNode, dependencies: ['a'] },
      },
    };
    const result = validateGraph(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('cycle'))).toBe(true);
  });

  it('detects three-node cycle A → B → C → A', () => {
    const map: MemoryMap = {
      version: '0.1',
      updated_at: new Date().toISOString(),
      nodes: {
        a: { ...goalNode, dependencies: ['b'] },
        b: { ...goalNode, dependencies: ['c'] },
        c: { ...goalNode, dependencies: ['a'] },
      },
      edges: [],
    };
    const result = validateGraph(map);
    expect(result.valid).toBe(false);
  });
});

describe('validateGraph — dangling references (spec section 5.2)', () => {
  it('detects dangling dependency', () => {
    const map: MemoryMap = {
      version: '0.1',
      updated_at: new Date().toISOString(),
      nodes: {
        'task-write-spec': { ...taskNode, dependencies: ['goal-launch-v1'] },
        // goal-launch-v1 is NOT in nodes
      },
      edges: [],
    };
    const result = validateGraph(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('dangling'))).toBe(true);
    expect(result.errors.some((e) => e.includes('goal-launch-v1'))).toBe(true);
  });

  it('multiple dangling refs are all reported', () => {
    const map: MemoryMap = {
      version: '0.1',
      updated_at: new Date().toISOString(),
      nodes: {
        a: { ...goalNode, dependencies: ['missing-1', 'missing-2'] },
      },
      edges: [],
    };
    const result = validateGraph(map);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('assertValidGraph — throws typed MskGraphError', () => {
  it('throws MskGraphError with violation: "cycle" on cycle', () => {
    const map: MemoryMap = {
      version: '0.1',
      updated_at: new Date().toISOString(),
      nodes: {
        a: { ...goalNode, dependencies: ['b'] },
        b: { ...goalNode, dependencies: ['a'] },
      },
      edges: [],
    };
    expect(() => assertValidGraph(map)).toThrow(MskGraphError);
    try {
      assertValidGraph(map);
    } catch (e) {
      expect((e as MskGraphError).violation).toBe('cycle');
    }
  });

  it('throws MskGraphError with violation: "dangling" on dangling ref', () => {
    const map: MemoryMap = {
      version: '0.1',
      updated_at: new Date().toISOString(),
      nodes: { a: { ...goalNode, dependencies: ['nonexistent'] } },
      edges: [],
    };
    expect(() => assertValidGraph(map)).toThrow(MskGraphError);
    try {
      assertValidGraph(map);
    } catch (e) {
      expect((e as MskGraphError).violation).toBe('dangling');
    }
  });

  it('does not throw on valid map', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'goal-launch-v1', goalNode);
    expect(() => assertValidGraph(map)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// upsertNode / removeNode
// ---------------------------------------------------------------------------

describe('upsertNode', () => {
  it('adds a new node', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'goal-launch-v1', goalNode);
    expect(map.nodes['goal-launch-v1']).toEqual(goalNode);
  });

  it('replaces an existing node', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'goal-launch-v1', goalNode);
    const updated = { ...goalNode, status: 'resolved' as const };
    map = upsertNode(map, 'goal-launch-v1', updated);
    expect(map.nodes['goal-launch-v1'].status).toBe('resolved');
    expect(Object.keys(map.nodes)).toHaveLength(1);
  });

  it('rebuilds edges from dependencies', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'goal-launch-v1', goalNode);
    map = upsertNode(map, 'task-write-spec', taskNode);
    expect(map.edges).toEqual([
      { from: 'task-write-spec', to: 'goal-launch-v1', relation: 'depends-on' },
    ]);
  });

  it('node with multiple deps creates multiple edges', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'a', { ...goalNode, dependencies: [] });
    map = upsertNode(map, 'b', { ...goalNode, dependencies: [] });
    map = upsertNode(map, 'c', { ...goalNode, dependencies: ['a', 'b'] });
    expect(map.edges).toHaveLength(2);
  });
});

describe('removeNode', () => {
  it('removes the node from nodes map', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'goal-launch-v1', goalNode);
    map = upsertNode(map, 'task-write-spec', taskNode);
    map = removeNode(map, 'task-write-spec');
    expect(map.nodes['task-write-spec']).toBeUndefined();
    expect(map.nodes['goal-launch-v1']).toBeDefined();
  });

  it('removes edges involving the removed node', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'goal-launch-v1', goalNode);
    map = upsertNode(map, 'task-write-spec', taskNode);
    expect(map.edges).toHaveLength(1);
    map = removeNode(map, 'task-write-spec');
    expect(map.edges).toHaveLength(0);
  });

  it('removing a non-existent node is a no-op', () => {
    const map = createEmptyMemoryMap();
    const result = removeNode(map, 'does-not-exist');
    expect(result.nodes).toEqual({});
  });
});
