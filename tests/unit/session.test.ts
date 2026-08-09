import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  sessionStart,
  sessionEnd,
  readActiveSessions,
  readNode,
  readMemoryMap,
  writeMemoryMap,
  createEmptyMemoryMap,
  writeAgentsConfig,
  readAgentsConfig,
  createDefaultAgentsConfig,
  commitNode,
} from '@mastishk/core';
import type { MskNode } from '@mastishk/core';

let tmpDir: string;
let mastishkDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-sess-'));
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
    id: 'task-example',
    type: 'task',
    layer: 'state',
    status: 'active',
    confidence: 0.8,
    created_by: 'claude-code',
    created_at: now,
    last_updated_by: 'claude-code',
    last_updated_at: now,
    dependencies: [],
    contradictions: [],
    body: 'An example task.',
    ...overrides,
  };
}

describe('sessionStart — spec section 15.1', () => {
  it('registers the session in sessions/active.json', async () => {
    await sessionStart(mastishkDir, 'claude-code', 'build auth');
    const raw = await readFile(join(mastishkDir, 'sessions', 'active.json'), 'utf-8');
    const registry = JSON.parse(raw);
    expect(registry.sessions).toHaveLength(1);
    expect(registry.sessions[0].agent).toBe('claude-code');
    expect(registry.sessions[0].task).toBe('build auth');
  });

  it('returns catchup and inject context', async () => {
    const result = await sessionStart(mastishkDir, 'claude-code', 'build auth');
    expect(result.catchup).toContain('Mastishk catchup — claude-code');
    expect(result.context).toContain('Mastishk context — build auth');
  });

  it('reports other active agents as presence', async () => {
    await sessionStart(mastishkDir, 'claude-code', 'build auth');
    const result = await sessionStart(mastishkDir, 'cursor', 'fix tests');
    expect(result.presence).toHaveLength(1);
    expect(result.presence[0].agent).toBe('claude-code');
  });

  it('re-registering the same agent replaces its session, no self-presence', async () => {
    await sessionStart(mastishkDir, 'claude-code', 'task one');
    const result = await sessionStart(mastishkDir, 'claude-code', 'task two');
    expect(result.presence).toHaveLength(0);
    const sessions = await readActiveSessions(mastishkDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].task).toBe('task two');
  });

  it('creates .mastishk/.gitignore excluding sessions/ (spec section 3)', async () => {
    await sessionStart(mastishkDir, 'claude-code', 'anything');
    const gitignore = await readFile(join(mastishkDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('sessions/');
  });
});

describe('session expiry — spec section 15.3', () => {
  it('expired sessions are silently dropped', async () => {
    const stale = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(); // 9h > 8h default
    await mkdir(join(mastishkDir, 'sessions'), { recursive: true });
    await writeFile(
      join(mastishkDir, 'sessions', 'active.json'),
      JSON.stringify({
        version: '0.3',
        sessions: [{ agent: 'crashed-agent', task: 'old work', started_at: stale }],
      }),
      'utf-8'
    );
    expect(await readActiveSessions(mastishkDir)).toHaveLength(0);

    const result = await sessionStart(mastishkDir, 'claude-code', 'new work');
    expect(result.presence).toHaveLength(0);
  });
});

describe('sessionEnd — spec section 15.2', () => {
  it('writes a handoff node to state/ and indexes it', async () => {
    await sessionStart(mastishkDir, 'claude-code', 'build auth');
    const result = await sessionEnd(mastishkDir, 'claude-code', {
      handoff: '**Done:** auth works.\n**Next:** rate limiting.',
    });
    expect(result.handoffId).toBeDefined();
    expect(result.warning).toBeUndefined();

    const map = await readMemoryMap(join(mastishkDir, 'memory-map.json'));
    const entry = map.nodes[result.handoffId!];
    expect(entry.type).toBe('handoff');
    expect(entry.layer).toBe('state');

    const handoff = await readNode(join(mastishkDir, entry.file));
    expect(handoff.body).toContain('auth works');
  });

  it('resolves the previous active handoff when a new one is written', async () => {
    const first = await sessionEnd(mastishkDir, 'claude-code', { handoff: 'First handoff.' });
    await new Promise((r) => setTimeout(r, 5)); // distinct handoff-<ms> IDs
    const second = await sessionEnd(mastishkDir, 'claude-code', { handoff: 'Second handoff.' });

    const map = await readMemoryMap(join(mastishkDir, 'memory-map.json'));
    expect(map.nodes[first.handoffId!].status).toBe('resolved');
    expect(map.nodes[second.handoffId!].status).toBe('active');
  });

  it('updates last_session_at in agents.json', async () => {
    await sessionEnd(mastishkDir, 'claude-code', { handoff: 'Done things.' });
    const config = await readAgentsConfig(mastishkDir);
    const agent = config?.registered_agents.find((a) => a.id === 'claude-code');
    expect(agent?.last_session_at).toBeTruthy();
    expect(Date.parse(agent!.last_session_at!)).not.toBeNaN();
  });

  it('deregisters the session', async () => {
    await sessionStart(mastishkDir, 'claude-code', 'work');
    await sessionEnd(mastishkDir, 'claude-code', { handoff: 'Done.' });
    expect(await readActiveSessions(mastishkDir)).toHaveLength(0);
  });

  it('without a handoff: warns but still deregisters', async () => {
    await sessionStart(mastishkDir, 'claude-code', 'work');
    const result = await sessionEnd(mastishkDir, 'claude-code', {});
    expect(result.warning).toContain('No handoff');
    expect(await readActiveSessions(mastishkDir)).toHaveLength(0);
  });

  it('auto-registers an unknown agent before recording last_session_at', async () => {
    await sessionEnd(mastishkDir, 'brand-new-agent', { handoff: 'Hello.' });
    const config = await readAgentsConfig(mastishkDir);
    const agent = config?.registered_agents.find((a) => a.id === 'brand-new-agent');
    expect(agent).toBeDefined();
    expect(agent?.last_session_at).toBeTruthy();
  });
});

describe('inject — handoff surfaced first (spec section 6.3)', () => {
  it('includes the latest active handoff regardless of seed match', async () => {
    await commitNode(mastishkDir, node({ id: 'goal-ship', type: 'goal', layer: 'intent', body: 'Ship it.' }));
    await sessionEnd(mastishkDir, 'claude-code', { handoff: 'Watch out for the flux capacitor.' });

    const { inject } = await import('@mastishk/core');
    const output = await inject('completely unrelated query zzz', mastishkDir);
    expect(output).toContain('### Handoff from last session');
    expect(output).toContain('flux capacitor');
  });

  it('renders the handoff before all other sections', async () => {
    await commitNode(mastishkDir, node({ id: 'goal-ship', type: 'goal', layer: 'intent', tags: ['ship'], body: 'Ship it.' }));
    await sessionEnd(mastishkDir, 'claude-code', { handoff: 'Handoff content here.' });

    const { inject } = await import('@mastishk/core');
    const output = await inject('ship', mastishkDir);
    const handoffIdx = output.indexOf('### Handoff from last session');
    const goalsIdx = output.indexOf('### Goals');
    expect(handoffIdx).toBeGreaterThan(-1);
    expect(goalsIdx).toBeGreaterThan(-1);
    expect(handoffIdx).toBeLessThan(goalsIdx);
  });
});
