import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readNode, writeNode, MskReadError, MskWriteError } from '@mastishk/core';
import type { MskNode } from '@mastishk/core';

// Use .000Z timestamps to survive gray-matter → Date → .toISOString() round-trip without format drift.
const baseNode: MskNode = {
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
  tags: ['launch', 'v1', 'npm'],
  body: 'Ship @mastishk/cli to npm and submit the arXiv paper before June 2026.',
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('round-trip: write then read', () => {
  it('intent layer node: all fields deeply equal (except last_updated_at which is refreshed)', async () => {
    const filePath = join(tmpDir, 'intent', 'goal-launch-v1.msk.md');
    await writeNode(filePath, baseNode);
    const read = await readNode(filePath);

    // last_updated_at is always updated to NOW by writeNode — compare everything else.
    const expected: MskNode = { ...baseNode, last_updated_at: read.last_updated_at };
    expect(read).toEqual(expected);

    // last_updated_at must be a valid ISO datetime and must be >= the original.
    expect(read.last_updated_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
    );
    expect(new Date(read.last_updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(baseNode.last_updated_at).getTime()
    );
  });

  it('node with no optional fields round-trips cleanly', async () => {
    const node: MskNode = {
      id: 'task-no-optionals',
      type: 'task',
      layer: 'state',
      status: 'active',
      confidence: 0.6,
      created_by: 'claude-code',
      created_at: '2026-05-12T00:00:00.000Z',
      last_updated_by: 'claude-code',
      last_updated_at: '2026-05-12T00:00:00.000Z',
      dependencies: [],
      contradictions: [],
      body: 'Working on task.',
    };
    const filePath = join(tmpDir, 'state', 'task-no-optionals.msk.md');
    await writeNode(filePath, node);
    const read = await readNode(filePath);

    // Optional fields must be absent (undefined), not serialized as null.
    expect(read.tags).toBeUndefined();
    expect(read.scanned).toBeUndefined();
    expect(read.verified).toBeUndefined();
    expect(read.expires_at).toBeUndefined();
  });

  it('preserves dependencies and contradictions arrays', async () => {
    const node: MskNode = {
      ...baseNode,
      id: 'task-with-deps',
      type: 'task',
      dependencies: ['goal-launch-v1', 'fact-tech-stack'],
      contradictions: ['decision-old-arch'],
    };
    const filePath = join(tmpDir, 'intent', 'task-with-deps.msk.md');
    await writeNode(filePath, node);
    const read = await readNode(filePath);
    expect(read.dependencies).toEqual(['goal-launch-v1', 'fact-tech-stack']);
    expect(read.contradictions).toEqual(['decision-old-arch']);
  });
});

// ---------------------------------------------------------------------------
// State layer: append-only (spec section 7.2)
// ---------------------------------------------------------------------------

describe('state layer: append-only writes', () => {
  it('second write appends body — both entries present', async () => {
    const node1: MskNode = {
      ...baseNode,
      id: 'task-state-append',
      type: 'task',
      layer: 'state',
      body: 'Started work on Phase 1.',
    };
    const node2: MskNode = { ...node1, body: 'Completed schema and validate.' };
    const filePath = join(tmpDir, 'state', 'task-state-append.msk.md');

    await writeNode(filePath, node1);
    await writeNode(filePath, node2);
    const read = await readNode(filePath);

    expect(read.body).toContain('Started work on Phase 1.');
    expect(read.body).toContain('Completed schema and validate.');
  });

  it('first write to state node includes append header', async () => {
    const node: MskNode = { ...baseNode, id: 'task-first-write', type: 'task', layer: 'state', body: 'Initial.' };
    const filePath = join(tmpDir, 'state', 'task-first-write.msk.md');

    await writeNode(filePath, node);
    const read = await readNode(filePath);

    // Body must contain the append header format: ### {timestamp} — {agent}
    expect(read.body).toMatch(/###\s+\d{4}-\d{2}-\d{2}T.+?—\s+human/);
    expect(read.body).toContain('Initial.');
  });

  it('three writes accumulate all entries in order', async () => {
    const base: MskNode = { ...baseNode, id: 'task-multi', type: 'task', layer: 'state', body: '' };
    const filePath = join(tmpDir, 'state', 'task-multi.msk.md');

    await writeNode(filePath, { ...base, body: 'Entry one.' });
    await writeNode(filePath, { ...base, body: 'Entry two.' });
    await writeNode(filePath, { ...base, body: 'Entry three.' });
    const read = await readNode(filePath);

    const bodyPos1 = read.body.indexOf('Entry one.');
    const bodyPos2 = read.body.indexOf('Entry two.');
    const bodyPos3 = read.body.indexOf('Entry three.');

    expect(bodyPos1).toBeGreaterThanOrEqual(0);
    expect(bodyPos2).toBeGreaterThan(bodyPos1);
    expect(bodyPos3).toBeGreaterThan(bodyPos2);
  });

  it('state layer updates frontmatter fields (status, confidence) on each write', async () => {
    const node1: MskNode = { ...baseNode, id: 'task-fm-update', type: 'task', layer: 'state', confidence: 0.6, body: 'Started.' };
    const node2: MskNode = { ...node1, status: 'resolved', confidence: 1.0, body: 'Done.' };
    const filePath = join(tmpDir, 'state', 'task-fm-update.msk.md');

    await writeNode(filePath, node1);
    await writeNode(filePath, node2);
    const read = await readNode(filePath);

    expect(read.status).toBe('resolved');
    expect(read.confidence).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Intent layer: replace (spec section 4.1)
// ---------------------------------------------------------------------------

describe('intent layer: replace writes', () => {
  it('second write replaces body — only latest body present', async () => {
    const filePath = join(tmpDir, 'intent', 'goal-launch-v1.msk.md');

    await writeNode(filePath, { ...baseNode, body: 'Original goal body.' });
    await writeNode(filePath, { ...baseNode, body: 'Updated goal body.' });
    const read = await readNode(filePath);

    expect(read.body).toBe('Updated goal body.');
    expect(read.body).not.toContain('Original goal body.');
  });

  it('knowledge layer write replaces body', async () => {
    const node: MskNode = {
      ...baseNode,
      id: 'decision-use-zod',
      type: 'decision',
      layer: 'knowledge',
      body: 'Original decision.',
    };
    const filePath = join(tmpDir, 'knowledge', 'decision-use-zod.msk.md');

    await writeNode(filePath, node);
    await writeNode(filePath, { ...node, body: 'Revised decision.' });
    const read = await readNode(filePath);

    expect(read.body).toBe('Revised decision.');
    expect(read.body).not.toContain('Original decision.');
  });
});

// ---------------------------------------------------------------------------
// Typed error: MskReadError
// ---------------------------------------------------------------------------

describe('MskReadError on invalid file', () => {
  it('throws MskReadError with filePath for file with invalid frontmatter', async () => {
    const filePath = join(tmpDir, 'invalid.msk.md');
    // id has spaces (not kebab-case), type is unknown
    await writeFile(
      filePath,
      '---\nid: bad node id\ntype: not-a-real-type\nlayer: intent\n---\nsome body',
      'utf-8'
    );

    await expect(readNode(filePath)).rejects.toBeInstanceOf(MskReadError);

    try {
      await readNode(filePath);
    } catch (e) {
      const err = e as MskReadError;
      expect(err.filePath).toBe(filePath);
      expect(err.validationErrors.length).toBeGreaterThan(0);
      expect(err.rawContent).toContain('bad node id');
    }
  });

  it('MskReadError.validationErrors includes the failing field name', async () => {
    const filePath = join(tmpDir, 'missing-fields.msk.md');
    // Missing almost all required fields
    await writeFile(filePath, '---\nid: test-node\n---\nbody here', 'utf-8');

    let caught: MskReadError | undefined;
    try {
      await readNode(filePath);
    } catch (e) {
      caught = e as MskReadError;
    }

    expect(caught).toBeInstanceOf(MskReadError);
    expect(caught!.validationErrors.some((e) => e.includes('type'))).toBe(true);
  });

  it('throws a plain Error (not MskReadError) when file does not exist', async () => {
    const filePath = join(tmpDir, 'does-not-exist.msk.md');
    await expect(readNode(filePath)).rejects.toThrow(Error);
    await expect(readNode(filePath)).rejects.not.toBeInstanceOf(MskReadError);
  });
});

// ---------------------------------------------------------------------------
// Typed error: MskWriteError
// ---------------------------------------------------------------------------

describe('MskWriteError on invalid node', () => {
  it('throws MskWriteError before writing when node is invalid', async () => {
    const filePath = join(tmpDir, 'should-not-exist.msk.md');
    const badNode = { ...baseNode, confidence: 99 } as unknown as MskNode;

    await expect(writeNode(filePath, badNode)).rejects.toBeInstanceOf(MskWriteError);

    // File must NOT have been created
    await expect(readNode(filePath)).rejects.toThrow();
  });

  it('MskWriteError.filePath is set correctly', async () => {
    const filePath = join(tmpDir, 'bad.msk.md');
    const badNode = { ...baseNode, type: 'not-real' } as unknown as MskNode;

    let caught: MskWriteError | undefined;
    try {
      await writeNode(filePath, badNode);
    } catch (e) {
      caught = e as MskWriteError;
    }

    expect(caught).toBeInstanceOf(MskWriteError);
    expect(caught!.filePath).toBe(filePath);
    expect(caught!.validationErrors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Directory creation
// ---------------------------------------------------------------------------

describe('writeNode creates parent directories', () => {
  it('creates nested directories that do not exist', async () => {
    const filePath = join(tmpDir, 'deep', 'nested', 'path', 'goal-test.msk.md');
    await expect(writeNode(filePath, baseNode)).resolves.not.toThrow();
    const read = await readNode(filePath);
    expect(read.id).toBe('goal-launch-v1');
  });
});
