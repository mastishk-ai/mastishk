/**
 * Compliance: spec v0.3 section 11 — plan nodes, `mastishk next`, `mastishk doctor`
 * - plan nodes carry ordered `steps`; `steps` is only valid on plan nodes (3.2)
 * - `next` MUST print the first unblocked step of the most recently updated
 *   active plan node, or `No active plan.` if none exists
 * - `doctor` MUST validate schema, layer/type pairing, graph constraints, ID
 *   uniqueness, expired nodes, stale map entries and stale sessions, and MUST
 *   signal a non-zero exit on any MUST-level violation
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  doctor,
  formatDoctorReport,
  findNextPlanStep,
  commitNode,
  makeMapNode,
  markStaleByPaths,
  readNode,
  readMemoryMap,
  writeMemoryMap,
  createEmptyMemoryMap,
  writeAgentsConfig,
  createDefaultAgentsConfig,
  validate,
} from '@mastishk/core';
import type { MskNode } from '@mastishk/core';
import { nextCommand, NO_ACTIVE_PLAN } from '../../src/packages/cli/src/commands/next-cmd.js';

let tmpDir: string;
let mastishkDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-c11-'));
  mastishkDir = join(tmpDir, '.mastishk');
  await writeMemoryMap(join(mastishkDir, 'memory-map.json'), createEmptyMemoryMap());
  await writeAgentsConfig(mastishkDir, createDefaultAgentsConfig());
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function stateNode(id: string, overrides: Partial<MskNode> = {}): MskNode {
  const now = new Date().toISOString();
  return {
    id,
    type: 'task',
    layer: 'state',
    status: 'active',
    confidence: 1,
    created_by: 'claude-code',
    created_at: now,
    last_updated_by: 'claude-code',
    last_updated_at: now,
    dependencies: [],
    contradictions: [],
    body: `Body of ${id}.`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Section 3.2 / 4.2 — plan nodes
// ---------------------------------------------------------------------------

describe('section 3.2 — plan node steps', () => {
  it('a plan node MAY carry ordered steps', () => {
    const plan = stateNode('plan-a', { type: 'plan', steps: ['task-one', 'task-two'] });
    expect(validate(plan).valid).toBe(true);
    expect(plan.steps).toEqual(['task-one', 'task-two']);
  });

  it('steps on a non-plan node MUST be rejected', () => {
    const bad = stateNode('task-a', { steps: ['task-one'] });
    const result = validate(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/steps/);
  });

  it('a plan node MUST live in the state layer', () => {
    const bad = stateNode('plan-a', { type: 'plan', layer: 'knowledge' });
    expect(validate(bad).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 11 — mastishk next
// ---------------------------------------------------------------------------

describe('section 11 — mastishk next', () => {
  it('MUST report no active plan when none exists', async () => {
    const { stepId } = await nextCommand({ cwd: tmpDir });
    expect(stepId).toBeNull();
    expect(NO_ACTIVE_PLAN).toBe('No active plan.');
  });

  it('MUST return the first unblocked step in plan order', async () => {
    await commitNode(mastishkDir, stateNode('task-one'));
    await commitNode(mastishkDir, stateNode('task-two'));
    await commitNode(mastishkDir, stateNode('plan-main', {
      type: 'plan', steps: ['task-one', 'task-two'],
    }));
    expect((await nextCommand({ cwd: tmpDir })).stepId).toBe('task-one');
  });

  it('MUST skip steps already resolved', async () => {
    await commitNode(mastishkDir, stateNode('task-one', { status: 'resolved' }));
    await commitNode(mastishkDir, stateNode('task-two'));
    await commitNode(mastishkDir, stateNode('plan-main', {
      type: 'plan', steps: ['task-one', 'task-two'],
    }));
    expect((await nextCommand({ cwd: tmpDir })).stepId).toBe('task-two');
  });

  it('MUST skip steps blocked by an unresolved task dependency', async () => {
    await commitNode(mastishkDir, stateNode('task-blocker'));
    await commitNode(mastishkDir, stateNode('task-one', { dependencies: ['task-blocker'] }));
    await commitNode(mastishkDir, stateNode('task-two'));
    await commitNode(mastishkDir, stateNode('plan-main', {
      type: 'plan', steps: ['task-one', 'task-two'],
    }));
    expect((await nextCommand({ cwd: tmpDir })).stepId).toBe('task-two');
  });

  it('uses the most recently updated active plan when several exist', async () => {
    const older = new Date(Date.now() - 86_400_000).toISOString();
    await commitNode(mastishkDir, stateNode('task-old'));
    await commitNode(mastishkDir, stateNode('task-new'));

    const nodes: Record<string, MskNode> = {
      'task-old': stateNode('task-old'),
      'task-new': stateNode('task-new'),
      'plan-old': stateNode('plan-old', {
        type: 'plan', steps: ['task-old'], last_updated_at: older,
      }),
      'plan-new': stateNode('plan-new', { type: 'plan', steps: ['task-new'] }),
    };
    expect(findNextPlanStep(nodes)).toBe('task-new');
  });

  it('a resolved plan is not an active plan', async () => {
    await commitNode(mastishkDir, stateNode('task-one'));
    await commitNode(mastishkDir, stateNode('plan-done', {
      type: 'plan', status: 'resolved', steps: ['task-one'],
    }));
    expect((await nextCommand({ cwd: tmpDir })).stepId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section 11 — mastishk doctor
// ---------------------------------------------------------------------------

describe('section 11 — mastishk doctor', () => {
  it('a healthy folder MUST report ok', async () => {
    await commitNode(mastishkDir, stateNode('task-one'));
    const report = await doctor(mastishkDir);
    expect(report.ok).toBe(true);
    expect(report.violations).toBe(0);
  });

  it('MUST detect a node that fails schema validation', async () => {
    await mkdir(join(mastishkDir, 'knowledge'), { recursive: true });
    await writeFile(
      join(mastishkDir, 'knowledge', 'bad.msk.md'),
      '---\nid: bad\n---\nNot a valid node.\n',
      'utf-8'
    );
    const report = await doctor(mastishkDir);
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.category === 'schema')).toBe(true);
  });

  it('MUST detect a layer/type pairing violation', async () => {
    await mkdir(join(mastishkDir, 'map'), { recursive: true });
    const now = new Date().toISOString();
    await writeFile(
      join(mastishkDir, 'map', 'bad-pair.msk.md'),
      `---\nid: bad-pair\ntype: decision\nlayer: map\nstatus: active\nconfidence: 1\ncreated_by: x\ncreated_at: ${now}\nlast_updated_by: x\nlast_updated_at: ${now}\ndependencies: []\ncontradictions: []\npath: src/a.ts\n---\nA decision in the map layer.\n`,
      'utf-8'
    );
    const report = await doctor(mastishkDir);
    expect(report.ok).toBe(false);
  });

  it('MUST detect duplicate IDs', async () => {
    await commitNode(mastishkDir, stateNode('task-dup'));
    await mkdir(join(mastishkDir, 'knowledge'), { recursive: true });
    const now = new Date().toISOString();
    await writeFile(
      join(mastishkDir, 'knowledge', 'task-dup.msk.md'),
      `---\nid: task-dup\ntype: fact\nlayer: knowledge\nstatus: active\nconfidence: 1\ncreated_by: x\ncreated_at: ${now}\nlast_updated_by: x\nlast_updated_at: ${now}\ndependencies: []\ncontradictions: []\n---\nDuplicate id.\n`,
      'utf-8'
    );
    const report = await doctor(mastishkDir);
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.category === 'duplicate-id')).toBe(true);
  });

  it('MUST detect graph constraint violations', async () => {
    await commitNode(mastishkDir, stateNode('task-one', { dependencies: ['ghost'] }));
    const report = await doctor(mastishkDir);
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.category === 'graph')).toBe(true);
  });

  it('MUST surface expired unresolved nodes', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    await commitNode(mastishkDir, stateNode('issue-old', {
      type: 'issue', layer: 'issues', expires_at: past, body: 'Expired issue.',
    }));
    const report = await doctor(mastishkDir);
    expect(report.findings.some((f) => f.category === 'expired')).toBe(true);
  });

  it('MUST surface stale map entries', async () => {
    await commitNode(mastishkDir, makeMapNode('map-a', 'src/a.ts', 'Alpha.', {
      created_by: 'claude-code', last_updated_by: 'claude-code',
    }));
    await markStaleByPaths(mastishkDir, ['src/a.ts']);
    const report = await doctor(mastishkDir);
    expect(report.findings.some((f) => f.category === 'stale-map')).toBe(true);
  });

  it('warnings alone MUST NOT produce a failing exit signal', async () => {
    await commitNode(mastishkDir, makeMapNode('map-a', 'src/a.ts', 'Alpha.', {
      created_by: 'claude-code', last_updated_by: 'claude-code',
    }));
    await markStaleByPaths(mastishkDir, ['src/a.ts']);
    const report = await doctor(mastishkDir);
    expect(report.warnings).toBeGreaterThan(0);
    expect(report.ok).toBe(true);
  });

  it('findings MUST be actionable — each names a category and a message', async () => {
    await commitNode(mastishkDir, stateNode('task-one', { dependencies: ['ghost'] }));
    const report = await doctor(mastishkDir);
    for (const finding of report.findings) {
      expect(finding.category.length).toBeGreaterThan(0);
      expect(finding.message.length).toBeGreaterThan(0);
      expect(['violation', 'warning']).toContain(finding.severity);
    }
    expect(formatDoctorReport(report).length).toBeGreaterThan(0);
  });
});
