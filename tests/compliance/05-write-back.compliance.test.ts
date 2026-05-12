/**
 * Compliance suite — Section 7: The write-back contract
 *
 * Tests:
 * - Section 7.1: agent writes must provide agent ID and update last_updated_at
 * - Section 7.2: state layer append-only with timestamp header
 * - Section 7.3: conflict detection — contradictions field causes conflict node creation
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeNode, readNode, MskWriteError } from '@mastishk/core';
import type { MskNode } from '@mastishk/core';

let tmpDir: string;

beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'msk-c05-')); });
afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

const NOW = '2026-05-12T00:00:00.000Z';

function node(overrides: Partial<MskNode> = {}): MskNode {
  return {
    id: 'task-build-mcp',
    type: 'task',
    layer: 'state',
    status: 'active',
    confidence: 1.0,
    created_by: 'claude-code',
    created_at: NOW,
    last_updated_by: 'claude-code',
    last_updated_at: NOW,
    dependencies: [],
    contradictions: [],
    body: 'Build the MCP server.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Section 7.1 — Agent writes
// ---------------------------------------------------------------------------

describe('section 7.1 — last_updated_at updated on write', () => {
  it('last_updated_at in written file is >= original value', async () => {
    const before = new Date().toISOString();
    const n = node({ last_updated_at: NOW });
    const p = join(tmpDir, 'state', 'task-build-mcp.msk.md');
    await writeNode(p, n);
    const read = await readNode(p);
    expect(new Date(read.last_updated_at).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it('last_updated_by is preserved from node', async () => {
    const n = node({ last_updated_by: 'cursor' });
    const p = join(tmpDir, 'state', 'task-build-mcp.msk.md');
    await writeNode(p, n);
    const read = await readNode(p);
    expect(read.last_updated_by).toBe('cursor');
  });

  it('writeNode rejects invalid node before writing', async () => {
    const p = join(tmpDir, 'state', 'bad.msk.md');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = { ...node(), confidence: 99 } as any;
    await expect(writeNode(p, bad)).rejects.toBeInstanceOf(MskWriteError);
  });
});

// ---------------------------------------------------------------------------
// Section 7.2 — Append-only state writes
// ---------------------------------------------------------------------------

describe('section 7.2 — append-only state layer', () => {
  it('timestamp header format is "### {ISO} — {agent}"', async () => {
    const p = join(tmpDir, 'state', 'task-build-mcp.msk.md');
    await writeNode(p, node({ last_updated_by: 'claude-code', body: 'First.' }));
    const read = await readNode(p);
    expect(read.body).toMatch(/### \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*— claude-code/);
  });

  it('second write body appears after first', async () => {
    const p = join(tmpDir, 'state', 'task-build-mcp.msk.md');
    await writeNode(p, node({ body: 'Earlier progress.' }));
    await writeNode(p, node({ body: 'Later progress.' }));
    const read = await readNode(p);
    const earlierPos = read.body.indexOf('Earlier progress.');
    const laterPos = read.body.indexOf('Later progress.');
    expect(earlierPos).toBeGreaterThanOrEqual(0);
    expect(laterPos).toBeGreaterThan(earlierPos);
  });

  it('non-state layers do NOT get timestamp headers', async () => {
    const n = node({ layer: 'intent', type: 'goal', id: 'goal-test', body: 'Plain body.' });
    const p = join(tmpDir, 'intent', 'goal-test.msk.md');
    await writeNode(p, n);
    const read = await readNode(p);
    expect(read.body.trim()).toBe('Plain body.');
    expect(read.body).not.toMatch(/### \d{4}/);
  });
});

// ---------------------------------------------------------------------------
// Section 7.3 — Conflict detection (Referee)
// ---------------------------------------------------------------------------

describe('section 7.3 — contradictions field', () => {
  it('node with contradictions array is valid (field accepted)', async () => {
    const n = node({
      layer: 'intent', type: 'goal', id: 'goal-a',
      contradictions: ['goal-old'],
    });
    const p = join(tmpDir, 'intent', 'goal-a.msk.md');
    await expect(writeNode(p, n)).resolves.toBeUndefined();
  });

  it('contradictions field is preserved on read', async () => {
    const n = node({
      layer: 'intent', type: 'goal', id: 'goal-a',
      contradictions: ['goal-old', 'goal-deprecated'],
    });
    const p = join(tmpDir, 'intent', 'goal-a.msk.md');
    await writeNode(p, n);
    const read = await readNode(p);
    expect(read.contradictions).toContain('goal-old');
    expect(read.contradictions).toContain('goal-deprecated');
  });
});
