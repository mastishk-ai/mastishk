import { describe, it, expect } from 'vitest';
import { traverse, createEmptyMemoryMap, upsertNode } from '@mastishk/core';
import type { MemoryMap, MemoryMapNode } from '@mastishk/core';

const make = (overrides: Partial<MemoryMapNode> = {}): MemoryMapNode => ({
  file: 'intent/node.msk.md',
  layer: 'intent',
  type: 'goal',
  status: 'active',
  confidence: 1.0,
  dependencies: [],
  ...overrides,
});

// Build a simple graph: goal ← task ← subtask
function buildLinearGraph(): MemoryMap {
  let map = createEmptyMemoryMap();
  map = upsertNode(map, 'goal', make({ layer: 'intent', confidence: 1.0 }));
  map = upsertNode(map, 'task', make({ layer: 'state', type: 'task', confidence: 0.8, dependencies: ['goal'] }));
  map = upsertNode(map, 'subtask', make({ layer: 'state', type: 'task', confidence: 0.6, dependencies: ['task'] }));
  return map;
}

// ---------------------------------------------------------------------------
// Basic traversal
// ---------------------------------------------------------------------------

describe('traverse — basic', () => {
  it('returns the seed node at depth 0', () => {
    const map = buildLinearGraph();
    const results = traverse(map, ['goal'], { depth: 0 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('goal');
    expect(results[0].depth).toBe(0);
  });

  it('returns seed + direct dependency at depth 1', () => {
    const map = buildLinearGraph();
    const results = traverse(map, ['task'], { depth: 1 });
    const ids = results.map((r) => r.id);
    expect(ids).toContain('task');
    expect(ids).toContain('goal');
    expect(ids).not.toContain('subtask');
  });

  it('default depth 2 follows two hops', () => {
    const map = buildLinearGraph();
    const results = traverse(map, ['subtask']);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('subtask');
    expect(ids).toContain('task');
    expect(ids).toContain('goal');
  });

  it('depth 1 from subtask stops before goal', () => {
    const map = buildLinearGraph();
    const results = traverse(map, ['subtask'], { depth: 1 });
    const ids = results.map((r) => r.id);
    expect(ids).toContain('subtask');
    expect(ids).toContain('task');
    expect(ids).not.toContain('goal');
  });

  it('result includes correct depth values', () => {
    const map = buildLinearGraph();
    const results = traverse(map, ['subtask']);
    const byId = Object.fromEntries(results.map((r) => [r.id, r.depth]));
    expect(byId['subtask']).toBe(0);
    expect(byId['task']).toBe(1);
    expect(byId['goal']).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Multiple seeds
// ---------------------------------------------------------------------------

describe('traverse — multiple seeds', () => {
  it('returns union of traversals without duplicates', () => {
    const map = buildLinearGraph();
    const results = traverse(map, ['task', 'subtask'], { depth: 1 });
    const ids = results.map((r) => r.id);
    // goal appears as dep of task (depth 1 from task seed)
    // task appears as dep of subtask (depth 1 from subtask seed)
    // subtask is a seed
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length); // no duplicates
    expect(ids).toContain('task');
    expect(ids).toContain('subtask');
  });
});

// ---------------------------------------------------------------------------
// Status filter
// ---------------------------------------------------------------------------

describe('traverse — statusFilter', () => {
  it('excludes resolved nodes by default', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'goal', make({ confidence: 1.0 }));
    map = upsertNode(map, 'task', make({ type: 'task', status: 'resolved', confidence: 0.8, dependencies: ['goal'] }));

    const results = traverse(map, ['task']); // default statusFilter: ['active']
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain('task'); // 'resolved' excluded
    expect(ids).not.toContain('goal'); // never reached because task was excluded
  });

  it('includes resolved nodes when statusFilter includes "resolved"', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'goal', make());
    map = upsertNode(map, 'task', make({ type: 'task', status: 'resolved', confidence: 0.8, dependencies: ['goal'] }));

    const results = traverse(map, ['task'], { statusFilter: ['active', 'resolved'] });
    const ids = results.map((r) => r.id);
    expect(ids).toContain('task');
    expect(ids).toContain('goal');
  });
});

// ---------------------------------------------------------------------------
// Confidence filter
// ---------------------------------------------------------------------------

describe('traverse — minConfidence', () => {
  it('excludes nodes below minConfidence', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'goal', make({ confidence: 1.0 }));
    map = upsertNode(map, 'low-conf', make({ type: 'fact', confidence: 0.3, dependencies: ['goal'] }));

    const results = traverse(map, ['low-conf']); // default minConfidence 0.5
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain('low-conf');
  });

  it('includes a node exactly at minConfidence threshold', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'node', make({ confidence: 0.5 }));
    const results = traverse(map, ['node'], { minConfidence: 0.5 });
    expect(results.map((r) => r.id)).toContain('node');
  });

  it('minConfidence: 0 returns all active nodes regardless of confidence', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'low', make({ confidence: 0.1 }));
    const results = traverse(map, ['low'], { minConfidence: 0 });
    expect(results.map((r) => r.id)).toContain('low');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('traverse — edge cases', () => {
  it('returns empty array for empty graph', () => {
    const map = createEmptyMemoryMap();
    expect(traverse(map, ['anything'])).toEqual([]);
  });

  it('returns empty array when seed does not exist in graph', () => {
    const map = buildLinearGraph();
    expect(traverse(map, ['nonexistent'])).toEqual([]);
  });

  it('handles a node with no dependencies gracefully', () => {
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'lone', make());
    const results = traverse(map, ['lone']);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('lone');
  });

  it('does not visit the same node twice (diamond dependency pattern)', () => {
    // A depends on B and C; both B and C depend on D
    let map = createEmptyMemoryMap();
    map = upsertNode(map, 'd', make({ layer: 'knowledge', type: 'fact' }));
    map = upsertNode(map, 'b', make({ type: 'task', dependencies: ['d'] }));
    map = upsertNode(map, 'c', make({ type: 'task', dependencies: ['d'] }));
    map = upsertNode(map, 'a', make({ type: 'task', dependencies: ['b', 'c'] }));

    const results = traverse(map, ['a'], { depth: 3 });
    const ids = results.map((r) => r.id);
    const dCount = ids.filter((id) => id === 'd').length;
    expect(dCount).toBe(1); // D visited only once
  });
});
