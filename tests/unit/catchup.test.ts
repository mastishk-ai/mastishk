import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  catchup,
  findNextPlanStep,
  sessionEnd,
  commitNode,
  writeMemoryMap,
  createEmptyMemoryMap,
  writeAgentsConfig,
  createDefaultAgentsConfig,
} from '@mastishk/core';
import type { MskNode, AgentsConfig } from '@mastishk/core';

let tmpDir: string;
let mastishkDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-catchup-'));
  mastishkDir = join(tmpDir, '.mastishk');
  await writeMemoryMap(join(mastishkDir, 'memory-map.json'), createEmptyMemoryMap());
  await writeAgentsConfig(mastishkDir, createDefaultAgentsConfig());
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function node(overrides: Partial<MskNode> = {}): MskNode {
  const now = new Date().toISOString();
  return {
    id: 'fact-example',
    type: 'fact',
    layer: 'knowledge',
    status: 'active',
    confidence: 0.8,
    created_by: 'claude-code',
    created_at: now,
    last_updated_by: 'claude-code',
    last_updated_at: now,
    dependencies: [],
    contradictions: [],
    body: 'Example fact body.',
    ...overrides,
  };
}

async function setLastSession(agent: string, at: string | null): Promise<void> {
  const config: AgentsConfig = createDefaultAgentsConfig();
  config.registered_agents = config.registered_agents.map((a) =>
    a.id === agent ? { ...a, last_session_at: at } : a
  );
  await writeAgentsConfig(mastishkDir, config);
}

describe('catchup — spec section 15.4', () => {
  it('reports nothing when memory is empty', async () => {
    const output = await catchup(mastishkDir, 'claude-code');
    expect(output).toContain('Nothing new since your last session.');
  });

  it('includes changes since a past last_session_at', async () => {
    await setLastSession('cursor', '2020-01-01T00:00:00Z');
    await commitNode(mastishkDir, node({ id: 'fact-orm', body: 'We use Drizzle ORM.' }));
    const output = await catchup(mastishkDir, 'cursor');
    expect(output).toContain('Knowledge (added or changed)');
    expect(output).toContain('fact-orm');
  });

  it('excludes changes older than last_session_at', async () => {
    await commitNode(mastishkDir, node({ id: 'fact-orm', body: 'We use Drizzle ORM.' }));
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await setLastSession('cursor', future);
    const output = await catchup(mastishkDir, 'cursor');
    expect(output).not.toContain('fact-orm');
  });

  it('a null last_session_at means full history', async () => {
    await commitNode(mastishkDir, node({ id: 'fact-orm', body: 'We use Drizzle ORM.' }));
    await setLastSession('cursor', null);
    const output = await catchup(mastishkDir, 'cursor');
    expect(output).toContain('the beginning of memory');
    expect(output).toContain('fact-orm');
  });

  it('surfaces the latest active handoff in full', async () => {
    await sessionEnd(mastishkDir, 'claude-code', {
      handoff: '**Watch out:** do not upgrade jsonwebtoken past v9.',
    });
    const output = await catchup(mastishkDir, 'cursor');
    expect(output).toContain('### Handoff');
    expect(output).toContain('jsonwebtoken past v9');
  });

  it('flags stale map nodes regardless of last_session_at', async () => {
    await commitNode(
      mastishkDir,
      node({
        id: 'map-src-auth', type: 'file', layer: 'map',
        path: 'src/auth.ts', stale: true, body: 'Handles JWT auth.',
      })
    );
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await setLastSession('cursor', future);
    const output = await catchup(mastishkDir, 'cursor');
    expect(output).toContain('Codebase map entries gone stale');
    expect(output).toContain('map-src-auth');
  });

  it('stays within 2000 characters', async () => {
    await setLastSession('cursor', '2020-01-01T00:00:00Z');
    for (let i = 0; i < 30; i++) {
      await commitNode(
        mastishkDir,
        node({ id: `fact-padding-${i}`, body: `Long fact number ${i}. `.repeat(20) })
      );
    }
    const output = await catchup(mastishkDir, 'cursor');
    expect(output.length).toBeLessThanOrEqual(2000);
  });
});

describe('findNextPlanStep — spec section 4.2', () => {
  function planNodes(): Record<string, MskNode> {
    return {
      'plan-v1': node({
        id: 'plan-v1', type: 'plan', layer: 'state',
        steps: ['task-a', 'task-b', 'task-c'],
      }),
      'task-a': node({ id: 'task-a', type: 'task', layer: 'state', status: 'resolved' }),
      'task-b': node({
        id: 'task-b', type: 'task', layer: 'state', dependencies: ['task-a', 'goal-x'],
      }),
      'task-c': node({ id: 'task-c', type: 'task', layer: 'state', dependencies: ['task-b'] }),
      'goal-x': node({ id: 'goal-x', type: 'goal', layer: 'intent', status: 'active' }),
    };
  }

  it('returns the first active step whose task dependencies are resolved', () => {
    expect(findNextPlanStep(planNodes())).toBe('task-b');
  });

  it('non-task dependencies (goals) do not block', () => {
    // task-b depends on goal-x (active) — must still be unblocked
    expect(findNextPlanStep(planNodes())).toBe('task-b');
  });

  it('a step blocked by an unresolved task is skipped', () => {
    const nodes = planNodes();
    nodes['task-a'] = { ...nodes['task-a'], status: 'active' };
    // task-b blocked by task-a; task-c blocked by task-b; task-a itself is first
    expect(findNextPlanStep(nodes)).toBe('task-a');
  });

  it('returns null without an active plan', () => {
    const nodes = planNodes();
    nodes['plan-v1'] = { ...nodes['plan-v1'], status: 'resolved' };
    expect(findNextPlanStep(nodes)).toBeNull();
  });
});
