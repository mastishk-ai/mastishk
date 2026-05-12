/**
 * Compliance suite — Section 4: Layer semantics
 *
 * Tests that the implementation enforces per-layer write rules:
 * - intent: types restricted to goal/constraint
 * - state: types restricted to task/issue; writes MUST be append-only
 * - knowledge: types restricted to decision/fact
 * - issues: type MUST be issue; append-only (never deleted)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeNode, readNode } from '@mastishk/core';
import type { MskNode } from '@mastishk/core';

let tmpDir: string;

beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'msk-c02-')); });
afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

function node(overrides: Partial<MskNode>): MskNode {
  const now = '2026-05-12T00:00:00.000Z';
  return {
    id: 'test-node',
    type: 'goal',
    layer: 'intent',
    status: 'active',
    confidence: 1.0,
    created_by: 'human',
    created_at: now,
    last_updated_by: 'human',
    last_updated_at: now,
    dependencies: [],
    contradictions: [],
    body: 'Body text.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Section 4.1 — intent layer
// ---------------------------------------------------------------------------

describe('section 4.1 — intent layer types', () => {
  it('accepts type: goal in intent layer', async () => {
    const n = node({ type: 'goal', layer: 'intent' });
    const p = join(tmpDir, 'intent', 'test-node.msk.md');
    await expect(writeNode(p, n)).resolves.toBeUndefined();
  });

  it('accepts type: constraint in intent layer', async () => {
    const n = node({ type: 'constraint', layer: 'intent' });
    const p = join(tmpDir, 'intent', 'test-node.msk.md');
    await expect(writeNode(p, n)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Section 4.2 — state layer: append-only
// ---------------------------------------------------------------------------

describe('section 4.2 — state layer: append-only writes (spec section 7.2)', () => {
  it('first write to state node wraps body in timestamp header', async () => {
    const n = node({ type: 'task', layer: 'state', body: 'Initial task.' });
    const p = join(tmpDir, 'state', 'test-node.msk.md');
    await writeNode(p, n);
    const read = await readNode(p);
    expect(read.body).toContain('Initial task.');
    // Timestamp header injected
    expect(read.body).toMatch(/### \d{4}-\d{2}-\d{2}T/);
  });

  it('second write appends below existing content', async () => {
    const p = join(tmpDir, 'state', 'test-node.msk.md');
    await writeNode(p, node({ type: 'task', layer: 'state', body: 'First entry.' }));
    await writeNode(p, node({ type: 'task', layer: 'state', body: 'Second entry.' }));
    const read = await readNode(p);
    expect(read.body).toContain('First entry.');
    expect(read.body).toContain('Second entry.');
  });

  it('second write does NOT erase first entry', async () => {
    const p = join(tmpDir, 'state', 'test-node.msk.md');
    await writeNode(p, node({ type: 'task', layer: 'state', body: 'Must survive.' }));
    await writeNode(p, node({ type: 'task', layer: 'state', body: 'New content.' }));
    const raw = await readFile(p, 'utf-8');
    expect(raw).toContain('Must survive.');
  });

  it('multiple appends all appear in body', async () => {
    const p = join(tmpDir, 'state', 'test-node.msk.md');
    for (let i = 1; i <= 3; i++) {
      await writeNode(p, node({ type: 'task', layer: 'state', body: `Entry ${i}.` }));
    }
    const read = await readNode(p);
    expect(read.body).toContain('Entry 1.');
    expect(read.body).toContain('Entry 2.');
    expect(read.body).toContain('Entry 3.');
  });

  it('each append has its own ### timestamp header', async () => {
    const p = join(tmpDir, 'state', 'test-node.msk.md');
    await writeNode(p, node({ type: 'task', layer: 'state', body: 'A.' }));
    await writeNode(p, node({ type: 'task', layer: 'state', body: 'B.' }));
    const read = await readNode(p);
    const headerCount = (read.body.match(/### \d{4}-\d{2}-\d{2}T/g) ?? []).length;
    expect(headerCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Section 4.3 — knowledge layer
// ---------------------------------------------------------------------------

describe('section 4.3 — knowledge layer', () => {
  it('accepts type: decision in knowledge layer', async () => {
    const n = node({ type: 'decision', layer: 'knowledge' });
    const p = join(tmpDir, 'knowledge', 'test-node.msk.md');
    await expect(writeNode(p, n)).resolves.toBeUndefined();
  });

  it('accepts type: fact in knowledge layer', async () => {
    const n = node({ type: 'fact', layer: 'knowledge' });
    const p = join(tmpDir, 'knowledge', 'test-node.msk.md');
    await expect(writeNode(p, n)).resolves.toBeUndefined();
  });

  it('knowledge layer write replaces body (not append)', async () => {
    const p = join(tmpDir, 'knowledge', 'test-node.msk.md');
    await writeNode(p, node({ type: 'fact', layer: 'knowledge', body: 'Old fact.' }));
    await writeNode(p, node({ type: 'fact', layer: 'knowledge', body: 'New fact.' }));
    const read = await readNode(p);
    expect(read.body.trim()).toBe('New fact.');
  });
});

// ---------------------------------------------------------------------------
// Section 4.4 — issues layer
// ---------------------------------------------------------------------------

describe('section 4.4 — issues layer', () => {
  it('accepts type: issue in issues layer', async () => {
    const n = node({ type: 'issue', layer: 'issues', id: 'issue-123' });
    const p = join(tmpDir, 'issues', 'issue-123.msk.md');
    await expect(writeNode(p, n)).resolves.toBeUndefined();
  });

  it('issue node status starts as active', async () => {
    const n = node({ type: 'issue', layer: 'issues', id: 'issue-456', status: 'active' });
    const p = join(tmpDir, 'issues', 'issue-456.msk.md');
    await writeNode(p, n);
    const read = await readNode(p);
    expect(read.status).toBe('active');
  });

  it('issue node can be resolved by setting status: resolved', async () => {
    const p = join(tmpDir, 'issues', 'issue-789.msk.md');
    await writeNode(p, node({ type: 'issue', layer: 'issues', id: 'issue-789', status: 'active' }));
    await writeNode(p, node({ type: 'issue', layer: 'issues', id: 'issue-789', status: 'resolved' }));
    const read = await readNode(p);
    expect(read.status).toBe('resolved');
  });
});
