import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  commitNode,
  makeMapNode,
  markStaleByPaths,
  writeMemoryMap,
  createEmptyMemoryMap,
  writeAgentsConfig,
  createDefaultAgentsConfig,
} from '@mastishk/core';
import type { MskNode } from '@mastishk/core';
import { mapCommand } from '../../src/packages/cli/src/commands/map-cmd.js';
import { nextCommand, NO_ACTIVE_PLAN } from '../../src/packages/cli/src/commands/next-cmd.js';
import { doctorCommand } from '../../src/packages/cli/src/commands/doctor-cmd.js';

let tmpDir: string;
let mastishkDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-cli3-'));
  mastishkDir = join(tmpDir, '.mastishk');
  await writeMemoryMap(join(mastishkDir, 'memory-map.json'), createEmptyMemoryMap());
  await writeAgentsConfig(mastishkDir, createDefaultAgentsConfig());
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function task(id: string, overrides: Partial<MskNode> = {}): MskNode {
  const now = new Date().toISOString();
  return {
    id,
    type: 'task',
    layer: 'state',
    status: 'active',
    confidence: 1,
    created_by: 'human',
    created_at: now,
    last_updated_by: 'human',
    last_updated_at: now,
    dependencies: [],
    contradictions: [],
    body: `Body of ${id}.`,
    ...overrides,
  };
}

describe('mastishk map — spec section 11', () => {
  it('returns no entries on a fresh memory folder', async () => {
    const { entries } = await mapCommand({ cwd: tmpDir });
    expect(entries).toEqual([]);
  });

  it('lists every map entry', async () => {
    await commitNode(mastishkDir, makeMapNode('map-a', 'src/a.ts', 'Alpha.', {
      created_by: 'x', last_updated_by: 'x',
    }));
    await commitNode(mastishkDir, makeMapNode('map-b', 'src/b.ts', 'Beta.', {
      created_by: 'x', last_updated_by: 'x',
    }));
    const { entries } = await mapCommand({ cwd: tmpDir });
    expect(entries.map((e) => e.id).sort()).toEqual(['map-a', 'map-b']);
  });

  it('--stale narrows to flagged entries only', async () => {
    await commitNode(mastishkDir, makeMapNode('map-a', 'src/a.ts', 'Alpha.', {
      created_by: 'x', last_updated_by: 'x',
    }));
    await commitNode(mastishkDir, makeMapNode('map-b', 'src/b.ts', 'Beta.', {
      created_by: 'x', last_updated_by: 'x',
    }));
    await markStaleByPaths(mastishkDir, ['src/b.ts']);

    const { entries } = await mapCommand({ cwd: tmpDir, stale: true });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe('map-b');
  });

  it('--refresh clears the flag', async () => {
    await commitNode(mastishkDir, makeMapNode('map-a', 'src/a.ts', 'Alpha.', {
      created_by: 'x', last_updated_by: 'x',
    }));
    await markStaleByPaths(mastishkDir, ['src/a.ts']);

    const result = await mapCommand({ cwd: tmpDir, refresh: 'map-a' });
    expect(result.refreshed).toBe('map-a');

    const { entries } = await mapCommand({ cwd: tmpDir, stale: true });
    expect(entries).toEqual([]);
  });

  it('--refresh on an unknown id is an error, not a silent no-op', async () => {
    await expect(mapCommand({ cwd: tmpDir, refresh: 'map-nope' })).rejects.toThrow(
      /No map node/
    );
  });
});

describe('mastishk next — spec section 11', () => {
  it('prints exactly "No active plan." when no plan node exists', async () => {
    const { stepId } = await nextCommand({ cwd: tmpDir });
    expect(stepId).toBeNull();
    expect(NO_ACTIVE_PLAN).toBe('No active plan.');
  });

  it('treats a resolved plan as no active plan', async () => {
    await commitNode(mastishkDir, task('task-one'));
    await commitNode(mastishkDir, task('plan-old', {
      type: 'plan', status: 'resolved', steps: ['task-one'],
    }));
    const { stepId } = await nextCommand({ cwd: tmpDir });
    expect(stepId).toBeNull();
  });

  it('returns the first unblocked step', async () => {
    await commitNode(mastishkDir, task('task-one'));
    await commitNode(mastishkDir, task('task-two'));
    await commitNode(mastishkDir, task('plan-main', {
      type: 'plan', steps: ['task-one', 'task-two'],
    }));
    const { stepId } = await nextCommand({ cwd: tmpDir });
    expect(stepId).toBe('task-one');
  });

  it('skips resolved steps', async () => {
    await commitNode(mastishkDir, task('task-one', { status: 'resolved' }));
    await commitNode(mastishkDir, task('task-two'));
    await commitNode(mastishkDir, task('plan-main', {
      type: 'plan', steps: ['task-one', 'task-two'],
    }));
    const { stepId } = await nextCommand({ cwd: tmpDir });
    expect(stepId).toBe('task-two');
  });

  it('skips a step blocked by an unresolved task dependency', async () => {
    await commitNode(mastishkDir, task('task-blocker'));
    await commitNode(mastishkDir, task('task-one', { dependencies: ['task-blocker'] }));
    await commitNode(mastishkDir, task('task-two'));
    await commitNode(mastishkDir, task('plan-main', {
      type: 'plan', steps: ['task-one', 'task-two'],
    }));
    const { stepId } = await nextCommand({ cwd: tmpDir });
    expect(stepId).toBe('task-two');
  });

  it('returns null when an active plan has no unblocked step', async () => {
    await commitNode(mastishkDir, task('task-blocker'));
    await commitNode(mastishkDir, task('task-one', { dependencies: ['task-blocker'] }));
    await commitNode(mastishkDir, task('plan-main', {
      type: 'plan', steps: ['task-one'],
    }));
    const { stepId } = await nextCommand({ cwd: tmpDir });
    expect(stepId).toBeNull();
  });
});

describe('mastishk doctor — spec section 11', () => {
  it('reports ok for a healthy folder', async () => {
    await commitNode(mastishkDir, task('task-one'));
    const report = await doctorCommand({ cwd: tmpDir });
    expect(report.ok).toBe(true);
  });

  it('reports not-ok when a MUST-level violation exists', async () => {
    await commitNode(mastishkDir, task('task-one', { dependencies: ['ghost'] }));
    const report = await doctorCommand({ cwd: tmpDir });
    expect(report.ok).toBe(false);
    expect(report.violations).toBeGreaterThan(0);
  });

  it('stays ok when only warnings are present', async () => {
    await commitNode(mastishkDir, makeMapNode('map-a', 'src/a.ts', 'Alpha.', {
      created_by: 'x', last_updated_by: 'x',
    }));
    await markStaleByPaths(mastishkDir, ['src/a.ts']);
    const report = await doctorCommand({ cwd: tmpDir });
    expect(report.ok).toBe(true);
    expect(report.warnings).toBeGreaterThan(0);
  });

  it('throws outside a mastishk project', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'msk-none-'));
    await expect(doctorCommand({ cwd: empty })).rejects.toThrow(/No \.mastishk/);
    await rm(empty, { recursive: true, force: true });
  });
});
