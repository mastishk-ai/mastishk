import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  writeNode,
  writeMemoryMap,
  readMemoryMap,
  readNode,
  createEmptyMemoryMap,
  upsertNode,
} from '@mastishk/core';
import type { MskNode, MemoryMapNode } from '@mastishk/core';
import { initCommand } from '../../src/packages/cli/src/commands/init.js';
import { injectCommand } from '../../src/packages/cli/src/commands/inject-cmd.js';
import { updateCommand } from '../../src/packages/cli/src/commands/update-cmd.js';
import { logCommand } from '../../src/packages/cli/src/commands/log-cmd.js';
import { statusCommand } from '../../src/packages/cli/src/commands/status.js';

let tmpDir: string;
beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'msk-cmd-')); });
afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeMskNode(overrides: Partial<MskNode> = {}): MskNode {
  return {
    id: 'goal-launch-v1',
    type: 'goal',
    layer: 'intent',
    status: 'active',
    confidence: 1.0,
    created_by: 'human',
    created_at: '2026-05-12T00:00:00.000Z',
    last_updated_by: 'human',
    last_updated_at: '2026-05-12T00:00:00.000Z',
    dependencies: [],
    contradictions: [],
    tags: ['launch', 'v1'],
    body: 'Ship @mastishk/cli to npm. Target 100 GitHub stars within 30 days.',
    ...overrides,
  };
}

async function seedMemory(): Promise<void> {
  await initCommand({ cwd: tmpDir });

  const goalFile = join(tmpDir, '.mastishk', 'intent', 'goal-launch-v1.msk.md');
  const taskFile = join(tmpDir, '.mastishk', 'state', 'task-write-spec.msk.md');

  await writeNode(goalFile, makeMskNode({
    id: 'goal-launch-v1', layer: 'intent', type: 'goal',
    tags: ['launch', 'v1'], body: 'Ship the npm package. Target 100 stars.',
  }));
  await writeNode(taskFile, makeMskNode({
    id: 'task-write-spec', layer: 'state', type: 'task',
    tags: ['spec'], dependencies: ['goal-launch-v1'],
    body: 'Write the protocol spec. Include all six claims.',
    confidence: 0.8,
  }));

  let map = createEmptyMemoryMap();
  map = upsertNode(map, 'goal-launch-v1', {
    file: 'intent/goal-launch-v1.msk.md', layer: 'intent', type: 'goal',
    status: 'active', confidence: 1.0, dependencies: [], tags: ['launch', 'v1'],
  } as MemoryMapNode);
  map = upsertNode(map, 'task-write-spec', {
    file: 'state/task-write-spec.msk.md', layer: 'state', type: 'task',
    status: 'active', confidence: 0.8, dependencies: ['goal-launch-v1'], tags: ['spec'],
  } as MemoryMapNode);
  await writeMemoryMap(join(tmpDir, '.mastishk', 'memory-map.json'), map);
}

// ---------------------------------------------------------------------------
// inject command
// ---------------------------------------------------------------------------

describe('injectCommand', () => {
  it('returns inject output string', async () => {
    await seedMemory();
    const output = await injectCommand('launch npm', { cwd: tmpDir });
    expect(typeof output).toBe('string');
    expect(output).toMatch(/## Mastishk context — launch npm/);
  });

  it('includes matching node in output', async () => {
    await seedMemory();
    const output = await injectCommand('launch', { cwd: tmpDir });
    expect(output).toContain('goal-launch-v1');
  });

  it('throws when .mastishk/ does not exist', async () => {
    await expect(injectCommand('task', { cwd: tmpDir })).rejects.toThrow('mastishk init');
  });
});

// ---------------------------------------------------------------------------
// update command
// ---------------------------------------------------------------------------

describe('updateCommand — status', () => {
  it('updates status to resolved', async () => {
    await seedMemory();
    await updateCommand('goal-launch-v1', { cwd: tmpDir, status: 'resolved' });

    const node = await readNode(join(tmpDir, '.mastishk', 'intent', 'goal-launch-v1.msk.md'));
    expect(node.status).toBe('resolved');
  });

  it('status update syncs to memory-map.json', async () => {
    await seedMemory();
    await updateCommand('goal-launch-v1', { cwd: tmpDir, status: 'deprecated' });

    const map = await readMemoryMap(join(tmpDir, '.mastishk', 'memory-map.json'));
    expect(map.nodes['goal-launch-v1'].status).toBe('deprecated');
  });

  it('status update does NOT append body for state layer nodes', async () => {
    await seedMemory();
    const before = await readNode(join(tmpDir, '.mastishk', 'state', 'task-write-spec.msk.md'));

    await updateCommand('task-write-spec', { cwd: tmpDir, status: 'resolved' });

    const after = await readNode(join(tmpDir, '.mastishk', 'state', 'task-write-spec.msk.md'));
    expect(after.status).toBe('resolved');
    // Body must not have grown — no append header added
    expect(after.body).toBe(before.body);
  });
});

describe('updateCommand — confidence', () => {
  it('updates confidence', async () => {
    await seedMemory();
    await updateCommand('goal-launch-v1', { cwd: tmpDir, confidence: '0.75' });

    const node = await readNode(join(tmpDir, '.mastishk', 'intent', 'goal-launch-v1.msk.md'));
    expect(node.confidence).toBe(0.75);
  });

  it('rejects confidence > 1.0', async () => {
    await seedMemory();
    await expect(updateCommand('goal-launch-v1', { cwd: tmpDir, confidence: '1.5' })).rejects.toThrow();
  });

  it('rejects non-numeric confidence', async () => {
    await seedMemory();
    await expect(updateCommand('goal-launch-v1', { cwd: tmpDir, confidence: 'high' })).rejects.toThrow();
  });
});

describe('updateCommand — error handling', () => {
  it('throws when node ID not found', async () => {
    await seedMemory();
    await expect(updateCommand('nonexistent-node', { cwd: tmpDir, status: 'resolved' })).rejects.toThrow('not found');
  });

  it('throws when .mastishk/ does not exist', async () => {
    await expect(updateCommand('any-id', { cwd: tmpDir })).rejects.toThrow('mastishk init');
  });
});

// ---------------------------------------------------------------------------
// log command
// ---------------------------------------------------------------------------

describe('logCommand', () => {
  it('creates an issue node file in issues/', async () => {
    await initCommand({ cwd: tmpDir });
    const id = await logCommand('Something went wrong.', { cwd: tmpDir });

    const node = await readNode(join(tmpDir, '.mastishk', `issues/${id}.msk.md`));
    expect(node.id).toBe(id);
    expect(node.type).toBe('issue');
    expect(node.layer).toBe('issues');
    expect(node.status).toBe('active');
    expect(node.body).toContain('Something went wrong.');
  });

  it('adds the node to memory-map.json', async () => {
    await initCommand({ cwd: tmpDir });
    const id = await logCommand('DB connection failed.', { cwd: tmpDir });

    const map = await readMemoryMap(join(tmpDir, '.mastishk', 'memory-map.json'));
    expect(map.nodes[id]).toBeDefined();
    expect(map.nodes[id].layer).toBe('issues');
  });

  it('--error flag adds "error" tag', async () => {
    await initCommand({ cwd: tmpDir });
    const id = await logCommand('Critical failure.', { cwd: tmpDir, error: true });

    const node = await readNode(join(tmpDir, '.mastishk', `issues/${id}.msk.md`));
    expect(node.tags).toContain('error');
  });

  it('without --error flag no error tag', async () => {
    await initCommand({ cwd: tmpDir });
    const id = await logCommand('Minor note.', { cwd: tmpDir });

    const node = await readNode(join(tmpDir, '.mastishk', `issues/${id}.msk.md`));
    expect(node.tags ?? []).not.toContain('error');
  });

  it('two log calls generate distinct IDs', async () => {
    await initCommand({ cwd: tmpDir });
    const id1 = await logCommand('First.', { cwd: tmpDir });
    await new Promise((r) => setTimeout(r, 2)); // ensure different timestamp
    const id2 = await logCommand('Second.', { cwd: tmpDir });
    expect(id1).not.toBe(id2);
  });

  it('throws when .mastishk/ does not exist', async () => {
    await expect(logCommand('test', { cwd: tmpDir })).rejects.toThrow('mastishk init');
  });
});

// ---------------------------------------------------------------------------
// status command
// ---------------------------------------------------------------------------

describe('statusCommand', () => {
  it('returns zero counts for empty memory', async () => {
    await initCommand({ cwd: tmpDir });
    const result = await statusCommand({ cwd: tmpDir });
    expect(result.totalNodes).toBe(0);
    expect(result.openIssues).toHaveLength(0);
    expect(result.staleNodes).toHaveLength(0);
  });

  it('counts nodes per layer correctly', async () => {
    await seedMemory();
    const result = await statusCommand({ cwd: tmpDir });
    expect(result.byLayer['intent']).toBe(1);
    expect(result.byLayer['state']).toBe(1);
    expect(result.totalNodes).toBe(2);
  });

  it('lists open issues', async () => {
    await initCommand({ cwd: tmpDir });
    const id = await logCommand('Open issue.', { cwd: tmpDir });
    const result = await statusCommand({ cwd: tmpDir });
    expect(result.openIssues).toContain(id);
  });

  it('resolved issue is not listed as open', async () => {
    await initCommand({ cwd: tmpDir });
    const id = await logCommand('Was an issue.', { cwd: tmpDir });
    await updateCommand(id, { cwd: tmpDir, status: 'resolved' });
    const result = await statusCommand({ cwd: tmpDir });
    expect(result.openIssues).not.toContain(id);
  });

  it('surfaces stale node when expires_at is in the past', async () => {
    await initCommand({ cwd: tmpDir });
    // Manually insert a node with an expired expires_at into memory-map.json
    const staleNode: MemoryMapNode & { expires_at?: string } = {
      file: 'intent/stale-goal.msk.md',
      layer: 'intent',
      type: 'goal',
      status: 'active',
      confidence: 0.8,
      dependencies: [],
      expires_at: '2020-01-01T00:00:00Z',
    };
    let map = await readMemoryMap(join(tmpDir, '.mastishk', 'memory-map.json'));
    map = upsertNode(map, 'stale-goal', staleNode);
    await writeMemoryMap(join(tmpDir, '.mastishk', 'memory-map.json'), map);

    const result = await statusCommand({ cwd: tmpDir });
    expect(result.staleNodes).toContain('stale-goal');
  });

  it('throws when .mastishk/ does not exist', async () => {
    await expect(statusCommand({ cwd: tmpDir })).rejects.toThrow('mastishk init');
  });
});
