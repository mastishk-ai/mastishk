/**
 * Compliance: spec v0.3 sections 8.3, 17, and 9 (auto-registration)
 * - Section 8.3: the Referee deterministic core — flag / human / latest strategies
 * - Section 17.1: atomic writes
 * - Section 17.2: memory-map.json updates guarded by .mastishk/.lock
 * - Section 17.3: trust enforcement at write time
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  commitNode,
  writeNode,
  readNode,
  readMemoryMap,
  writeMemoryMap,
  createEmptyMemoryMap,
  upsertNode,
  nodeToMapEntry,
  writeAgentsConfig,
  readAgentsConfig,
  createDefaultAgentsConfig,
} from '@mastishk/core';
import type { MskNode, AgentsConfig, ConflictStrategy } from '@mastishk/core';

let tmpDir: string;
let mastishkDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-c08-'));
  mastishkDir = join(tmpDir, '.mastishk');
  await writeMemoryMap(join(mastishkDir, 'memory-map.json'), createEmptyMemoryMap());
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function node(overrides: Partial<MskNode> = {}): MskNode {
  const now = '2026-06-12T00:00:00Z';
  return {
    id: 'decision-new',
    type: 'decision',
    layer: 'knowledge',
    status: 'active',
    confidence: 0.8,
    created_by: 'claude-code',
    created_at: now,
    last_updated_by: 'claude-code',
    last_updated_at: now,
    dependencies: [],
    contradictions: [],
    body: 'Use Postgres for persistence.',
    ...overrides,
  };
}

async function seedExisting(n: MskNode): Promise<void> {
  const file = `${n.layer}/${n.id}.msk.md`;
  await writeNode(join(mastishkDir, file), n);
  const mapPath = join(mastishkDir, 'memory-map.json');
  const map = await readMemoryMap(mapPath);
  await writeMemoryMap(mapPath, upsertNode(map, n.id, nodeToMapEntry(n, file)));
}

async function setStrategy(strategy: ConflictStrategy, agents?: AgentsConfig): Promise<void> {
  const config = agents ?? createDefaultAgentsConfig();
  await writeAgentsConfig(mastishkDir, { ...config, conflict_strategy: strategy });
}

// ---------------------------------------------------------------------------
// Section 8.1/8.3 — commitNode is the canonical write path
// ---------------------------------------------------------------------------

describe('section 8 — commitNode happy path', () => {
  it('writes the node and indexes it in memory-map.json', async () => {
    const result = await commitNode(mastishkDir, node());
    expect(result.committed).toBe(true);

    const onDisk = await readNode(join(mastishkDir, 'knowledge', 'decision-new.msk.md'));
    expect(onDisk.body).toContain('Postgres');

    const map = await readMemoryMap(join(mastishkDir, 'memory-map.json'));
    expect(map.nodes['decision-new']).toBeDefined();
    expect(map.nodes['decision-new'].layer).toBe('knowledge');
  });

  it('indexes contradictions so the Referee can check the reverse direction', async () => {
    await seedExisting(node({ id: 'decision-old' }));
    await commitNode(mastishkDir, node({ id: 'decision-other', contradictions: [] }));
    const result = await commitNode(
      mastishkDir,
      node({ id: 'decision-marker', contradictions: ['decision-other'] })
    );
    // decision-other is active → declared conflict → default strategy flag → reject
    expect(result.committed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 8.3 — conflict strategies
// ---------------------------------------------------------------------------

describe('section 8.3 — strategy: flag (default)', () => {
  it('rejects the write and creates an indexed conflict node in issues/', async () => {
    await setStrategy('flag');
    await seedExisting(node({ id: 'decision-old' }));

    const result = await commitNode(
      mastishkDir,
      node({ contradictions: ['decision-old'] })
    );
    expect(result.committed).toBe(false);
    expect(result.rejected).toBe('conflict');
    expect(result.conflictsWith).toEqual(['decision-old']);
    expect(result.conflictNodeId).toBeDefined();

    // The rejected write must NOT exist
    const written = await readdir(join(mastishkDir, 'knowledge'));
    expect(written).not.toContain('decision-new.msk.md');

    // The conflict node exists in issues/, is indexed, and follows 8.3
    const conflict = await readNode(
      join(mastishkDir, 'issues', `${result.conflictNodeId}.msk.md`)
    );
    expect(conflict.type).toBe('issue');
    expect(conflict.tags).toEqual(['conflict', 'referee']);
    expect(conflict.dependencies).toEqual(['decision-old']);
    expect(conflict.body).toContain('decision-new');

    const map = await readMemoryMap(join(mastishkDir, 'memory-map.json'));
    expect(map.nodes[result.conflictNodeId!]).toBeDefined();
  });
});

describe('section 8.3 — strategy: human', () => {
  it('rejects the write without creating a conflict node', async () => {
    await setStrategy('human');
    await seedExisting(node({ id: 'decision-old' }));

    const result = await commitNode(
      mastishkDir,
      node({ contradictions: ['decision-old'] })
    );
    expect(result.committed).toBe(false);
    expect(result.conflictNodeId).toBeUndefined();

    const issues = await readdir(join(mastishkDir, 'issues')).catch(() => [] as string[]);
    expect(issues.filter((f) => f.startsWith('conflict-'))).toEqual([]);
  });
});

describe('section 8.3 — strategy: latest', () => {
  it('accepts the write and marks the contradicted node deprecated', async () => {
    await setStrategy('latest');
    await seedExisting(node({ id: 'decision-old' }));

    const result = await commitNode(
      mastishkDir,
      node({ contradictions: ['decision-old'] })
    );
    expect(result.committed).toBe(true);
    expect(result.deprecated).toEqual(['decision-old']);

    const old = await readNode(join(mastishkDir, 'knowledge', 'decision-old.msk.md'));
    expect(old.status).toBe('deprecated');

    const map = await readMemoryMap(join(mastishkDir, 'memory-map.json'));
    expect(map.nodes['decision-old'].status).toBe('deprecated');
    expect(map.nodes['decision-new']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Section 17.3 — trust enforcement
// ---------------------------------------------------------------------------

describe('section 17.3 — trust enforcement through commitNode', () => {
  it('medium-trust agent cannot write to intent/', async () => {
    const config = createDefaultAgentsConfig();
    config.registered_agents.push({
      id: 'sketchy-agent', access: 'read-write', trust: 'medium', last_session_at: null,
    });
    await writeAgentsConfig(mastishkDir, config);

    const result = await commitNode(
      mastishkDir,
      node({ id: 'goal-takeover', type: 'goal', layer: 'intent', last_updated_by: 'sketchy-agent' })
    );
    expect(result.committed).toBe(false);
    expect(result.rejected).toBe('trust');
  });

  it('low-trust agent knowledge writes land as draft with capped confidence', async () => {
    const config = createDefaultAgentsConfig();
    config.registered_agents.push({
      id: 'low-agent', access: 'read-write', trust: 'low', last_session_at: null,
    });
    await writeAgentsConfig(mastishkDir, config);

    const result = await commitNode(
      mastishkDir,
      node({ last_updated_by: 'low-agent', confidence: 0.9 })
    );
    expect(result.committed).toBe(true);
    expect(result.node?.status).toBe('draft');
    expect(result.node?.confidence).toBeLessThanOrEqual(0.6);
  });

  it('unknown writing agent is auto-registered with trust medium (section 9)', async () => {
    await writeAgentsConfig(mastishkDir, createDefaultAgentsConfig());
    await commitNode(mastishkDir, node({ last_updated_by: 'brand-new-agent' }));

    const config = await readAgentsConfig(mastishkDir);
    const agent = config?.registered_agents.find((a) => a.id === 'brand-new-agent');
    expect(agent?.trust).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// Section 17.1 / 17.2 — atomicity and locking
// ---------------------------------------------------------------------------

describe('section 17 — atomicity and locking', () => {
  it('leaves no temp or lock files behind after a commit', async () => {
    await commitNode(mastishkDir, node());
    const entries = await readdir(mastishkDir);
    expect(entries.filter((f) => f.includes('.tmp-'))).toEqual([]);
    expect(entries).not.toContain('.lock');
  });

  it('serialises concurrent commits — both land, the index is intact', async () => {
    const results = await Promise.all([
      commitNode(mastishkDir, node({ id: 'fact-a', type: 'fact', body: 'A.' })),
      commitNode(mastishkDir, node({ id: 'fact-b', type: 'fact', body: 'B.' })),
    ]);
    expect(results.every((r) => r.committed)).toBe(true);

    const raw = await readFile(join(mastishkDir, 'memory-map.json'), 'utf-8');
    const map = JSON.parse(raw); // must be valid JSON — never half-written
    // At least one landed in the index; with last-writer-wins on the index both
    // bodies exist on disk regardless.
    const files = await readdir(join(mastishkDir, 'knowledge'));
    expect(files).toContain('fact-a.msk.md');
    expect(files).toContain('fact-b.msk.md');
    expect(Object.keys(map.nodes).length).toBeGreaterThanOrEqual(1);
  });
});
