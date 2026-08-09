import { describe, it, expect } from 'vitest';
import {
  referee,
  createConflictNode,
  createEmptyMemoryMap,
  upsertNode,
  nodeToMapEntry,
  validate,
} from '@mastishk/core';
import type { MskNode, MemoryMap } from '@mastishk/core';

function node(overrides: Partial<MskNode> = {}): MskNode {
  return {
    id: 'decision-new',
    type: 'decision',
    layer: 'knowledge',
    status: 'active',
    confidence: 0.8,
    created_by: 'claude-code',
    created_at: '2026-06-12T00:00:00Z',
    last_updated_by: 'claude-code',
    last_updated_at: '2026-06-12T00:00:00Z',
    dependencies: [],
    contradictions: [],
    body: 'Use Postgres for persistence.',
    ...overrides,
  };
}

function mapWith(...nodes: MskNode[]): MemoryMap {
  let map = createEmptyMemoryMap();
  for (const n of nodes) {
    map = upsertNode(map, n.id, nodeToMapEntry(n, `${n.layer}/${n.id}.msk.md`));
  }
  return map;
}

describe('referee — spec section 8.3 deterministic core', () => {
  it('accepts a write with no declared conflicts', () => {
    const map = mapWith(node({ id: 'decision-old' }));
    const decision = referee(map, node(), 'flag');
    expect(decision.outcome).toBe('accept');
    expect(decision.conflictsWith).toEqual([]);
  });

  it('detects incoming contradictions against an existing active node', () => {
    const map = mapWith(node({ id: 'decision-old' }));
    const incoming = node({ contradictions: ['decision-old'] });
    const decision = referee(map, incoming, 'flag');
    expect(decision.outcome).toBe('reject');
    expect(decision.conflictsWith).toEqual(['decision-old']);
    expect(decision.conflictNode).toBeDefined();
  });

  it('ignores contradictions pointing at non-active nodes', () => {
    const map = mapWith(node({ id: 'decision-old', status: 'deprecated' }));
    const incoming = node({ contradictions: ['decision-old'] });
    expect(referee(map, incoming, 'flag').outcome).toBe('accept');
  });

  it('detects the reverse direction: existing node contradicts the incoming ID', () => {
    const map = mapWith(node({ id: 'decision-old', contradictions: ['decision-new'] }));
    const decision = referee(map, node({ id: 'decision-new' }), 'flag');
    expect(decision.outcome).toBe('reject');
    expect(decision.conflictsWith).toEqual(['decision-old']);
  });

  it('strategy "human" rejects without creating a conflict node', () => {
    const map = mapWith(node({ id: 'decision-old' }));
    const decision = referee(map, node({ contradictions: ['decision-old'] }), 'human');
    expect(decision.outcome).toBe('reject');
    expect(decision.conflictNode).toBeUndefined();
  });

  it('strategy "latest" accepts and reports nodes to deprecate', () => {
    const map = mapWith(node({ id: 'decision-old' }));
    const decision = referee(map, node({ contradictions: ['decision-old'] }), 'latest');
    expect(decision.outcome).toBe('accept-deprecate');
    expect(decision.conflictsWith).toEqual(['decision-old']);
  });
});

describe('createConflictNode — spec section 8.3', () => {
  const incoming = node({ contradictions: ['decision-old'] });
  const conflict = createConflictNode(incoming, ['decision-old']);

  it('is a schema-valid issue node', () => {
    const result = validate(conflict);
    expect(result.valid).toBe(true);
    expect(conflict.type).toBe('issue');
    expect(conflict.layer).toBe('issues');
  });

  it('carries tags [conflict, referee]', () => {
    expect(conflict.tags).toEqual(['conflict', 'referee']);
  });

  it('references the contradicting node in dependencies, not the rejected write', () => {
    expect(conflict.dependencies).toEqual(['decision-old']);
    expect(conflict.dependencies).not.toContain(incoming.id);
  });

  it('identifies the rejected write in the body', () => {
    expect(conflict.body).toContain(incoming.id);
    expect(conflict.body).toContain(incoming.body);
  });
});
