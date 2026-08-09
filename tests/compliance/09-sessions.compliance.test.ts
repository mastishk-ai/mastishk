/**
 * Compliance: spec v0.3 section 15 — the session protocol
 * - 15.1 session start: presence registration, catchup + inject returned
 * - 15.2 session end: handoff node, last_session_at, deregistration
 * - 15.3 stale sessions expire silently
 * - 15.4 catchup output ordering
 * - 6.3 inject surfaces the most recent active handoff first
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  sessionStart,
  sessionEnd,
  readActiveSessions,
  catchup,
  inject,
  commitNode,
  readMemoryMap,
  writeMemoryMap,
  createEmptyMemoryMap,
  writeAgentsConfig,
  readAgentsConfig,
  createDefaultAgentsConfig,
} from '@mastishk/core';
import type { MskNode, AgentsConfig } from '@mastishk/core';

let tmpDir: string;
let mastishkDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-c09-'));
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
    body: 'Example body.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Section 15.1 — session start
// ---------------------------------------------------------------------------

describe('section 15.1 — session start', () => {
  it('registers presence with agent, task, and started_at', async () => {
    await sessionStart(mastishkDir, 'claude-code', 'implement sessions');
    const sessions = await readActiveSessions(mastishkDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].agent).toBe('claude-code');
    expect(sessions[0].task).toBe('implement sessions');
    expect(Date.parse(sessions[0].started_at)).not.toBeNaN();
  });

  it('warns about other unexpired sessions (presence)', async () => {
    await sessionStart(mastishkDir, 'claude-code', 'feature work');
    const second = await sessionStart(mastishkDir, 'cursor', 'bug fixing');
    expect(second.presence.map((s) => s.agent)).toEqual(['claude-code']);
  });

  it('returns the catchup output and the inject output for the task', async () => {
    const result = await sessionStart(mastishkDir, 'claude-code', 'auth work');
    expect(result.catchup).toContain('Mastishk catchup');
    expect(result.context).toContain('## Mastishk context — auth work');
  });

  it('does not create any memory nodes (read + presence only)', async () => {
    await sessionStart(mastishkDir, 'claude-code', 'auth work');
    const map = await readMemoryMap(join(mastishkDir, 'memory-map.json'));
    expect(Object.keys(map.nodes)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Section 15.2 — session end
// ---------------------------------------------------------------------------

describe('section 15.2 — session end', () => {
  it('creates a handoff node in state/ with type handoff', async () => {
    await sessionStart(mastishkDir, 'claude-code', 'work');
    const result = await sessionEnd(mastishkDir, 'claude-code', {
      handoff: '**Done:** sessions implemented.',
    });
    expect(result.handoffId).toBeDefined();

    const map = await readMemoryMap(join(mastishkDir, 'memory-map.json'));
    const entry = map.nodes[result.handoffId!];
    expect(entry).toBeDefined();
    expect(entry.layer).toBe('state');
    expect(entry.type).toBe('handoff');
    expect(entry.file.startsWith('state/')).toBe(true);
  });

  it('sets last_session_at for the agent in agents.json', async () => {
    const before = Date.now() - 1000;
    await sessionEnd(mastishkDir, 'cursor', { handoff: 'Did things.' });
    const config = await readAgentsConfig(mastishkDir);
    const agent = config?.registered_agents.find((a) => a.id === 'cursor');
    expect(Date.parse(agent!.last_session_at!)).toBeGreaterThanOrEqual(before);
  });

  it('removes the session from the registry', async () => {
    await sessionStart(mastishkDir, 'claude-code', 'work');
    await sessionEnd(mastishkDir, 'claude-code', { handoff: 'Done.' });
    expect(await readActiveSessions(mastishkDir)).toHaveLength(0);
  });

  it('a non-interactive end without a handoff still deregisters but warns', async () => {
    await sessionStart(mastishkDir, 'claude-code', 'work');
    const result = await sessionEnd(mastishkDir, 'claude-code', {});
    expect(result.warning).toBeTruthy();
    expect(await readActiveSessions(mastishkDir)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Section 15.3 — stale sessions
// ---------------------------------------------------------------------------

describe('section 15.3 — stale session expiry', () => {
  it('sessions older than session_timeout_hours never block another agent', async () => {
    const config = (await readAgentsConfig(mastishkDir)) as AgentsConfig;
    await writeAgentsConfig(mastishkDir, { ...config, session_timeout_hours: 1 });

    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await mkdir(join(mastishkDir, 'sessions'), { recursive: true });
    await writeFile(
      join(mastishkDir, 'sessions', 'active.json'),
      JSON.stringify({
        version: '0.3',
        sessions: [{ agent: 'crashed', task: 'old', started_at: stale }],
      }),
      'utf-8'
    );

    expect(await readActiveSessions(mastishkDir)).toHaveLength(0);
    const result = await sessionStart(mastishkDir, 'claude-code', 'fresh work');
    expect(result.presence).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Section 15.4 — catchup output ordering
// ---------------------------------------------------------------------------

describe('section 15.4 — catchup ordering', () => {
  it('orders: handoff, resolved tasks, issues, knowledge, stale map, next step', async () => {
    // Seed every category
    await sessionEnd(mastishkDir, 'claude-code', { handoff: 'HANDOFF-MARKER content.' });
    await commitNode(mastishkDir, node({ id: 'task-done', type: 'task', layer: 'state', status: 'resolved' }));
    await commitNode(mastishkDir, node({ id: 'issue-flaky', type: 'issue', layer: 'issues', body: 'Flaky test.' }));
    await commitNode(mastishkDir, node({ id: 'fact-orm', body: 'We use Drizzle.' }));
    await commitNode(mastishkDir, node({
      id: 'map-src-auth', type: 'file', layer: 'map', path: 'src/auth.ts', stale: true, body: 'Auth module.',
    }));
    await commitNode(mastishkDir, node({ id: 'task-next', type: 'task', layer: 'state' }));
    await commitNode(mastishkDir, node({
      id: 'plan-v1', type: 'plan', layer: 'state', steps: ['task-done', 'task-next'],
    }));

    // cursor has never had a session — sees everything
    const output = await catchup(mastishkDir, 'cursor');

    const positions = [
      output.indexOf('HANDOFF-MARKER'),
      output.indexOf('Resolved since your last session'),
      output.indexOf('Issues (new or updated)'),
      output.indexOf('Knowledge (added or changed)'),
      output.indexOf('Codebase map entries gone stale'),
      output.indexOf('Next unblocked plan step'),
    ];
    for (const p of positions) expect(p).toBeGreaterThan(-1);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    expect(output).toContain('task-next'); // the unblocked step
  });

  it('SHOULD fit in 2000 characters', async () => {
    for (let i = 0; i < 40; i++) {
      await commitNode(mastishkDir, node({ id: `fact-f${i}`, body: `Fact ${i}. `.repeat(30) }));
    }
    const output = await catchup(mastishkDir, 'cursor');
    expect(output.length).toBeLessThanOrEqual(2000);
  });
});

// ---------------------------------------------------------------------------
// Section 6.3 — inject surfaces the handoff first and never drops it
// ---------------------------------------------------------------------------

describe('section 6.3 — handoff in inject output', () => {
  it('appears before all other sections, regardless of seed match', async () => {
    await commitNode(mastishkDir, node({
      id: 'goal-ship', type: 'goal', layer: 'intent', tags: ['ship'], body: 'Ship the release.',
    }));
    await sessionEnd(mastishkDir, 'claude-code', { handoff: 'UNIQUE-HANDOFF-TOKEN here.' });

    const output = await inject('ship', mastishkDir);
    const handoffIdx = output.indexOf('### Handoff from last session');
    expect(handoffIdx).toBeGreaterThan(-1);
    expect(output).toContain('UNIQUE-HANDOFF-TOKEN');
    const goalsIdx = output.indexOf('### Goals');
    expect(goalsIdx).toBeGreaterThan(handoffIdx);
  });

  it('survives the output budget even with many high-volume nodes', async () => {
    await sessionEnd(mastishkDir, 'claude-code', { handoff: 'UNIQUE-HANDOFF-TOKEN survives.' });
    for (let i = 0; i < 50; i++) {
      await commitNode(mastishkDir, node({
        id: `fact-big-${i}`, tags: ['everything'], confidence: 0.95,
        body: `${'Very long body. '.repeat(40)}`,
      }));
    }
    const output = await inject('everything', mastishkDir);
    expect(output).toContain('UNIQUE-HANDOFF-TOKEN');
  });
});
