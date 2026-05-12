/**
 * Compliance suite — Section 3: Node format
 *
 * Tests that the implementation correctly enforces .msk.md node structure,
 * YAML frontmatter required/optional fields, and body content rules.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validate, readNode, writeNode, MskReadError } from '@mastishk/core';
import type { MskNode } from '@mastishk/core';

let tmpDir: string;

beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'msk-c01-')); });
afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

function baseNode(overrides: Partial<MskNode> = {}): MskNode {
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
    body: 'Ship Mastishk v1 to npm before June 2026.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Section 3.1 — File naming
// ---------------------------------------------------------------------------

describe('section 3.1 — file naming', () => {
  it('node written at {layer}/{id}.msk.md is readable back', async () => {
    const node = baseNode();
    const filePath = join(tmpDir, 'intent', 'goal-launch-v1.msk.md');
    await writeNode(filePath, node);
    const read = await readNode(filePath);
    expect(read.id).toBe('goal-launch-v1');
  });

  it('id MUST be kebab-case — rejects uppercase', () => {
    const result = validate(baseNode({ id: 'GoalLaunch' }));
    expect(result.valid).toBe(false);
  });

  it('id MUST be kebab-case — rejects spaces', () => {
    const result = validate(baseNode({ id: 'goal launch' }));
    expect(result.valid).toBe(false);
  });

  it('id MUST be kebab-case — rejects leading hyphen', () => {
    const result = validate(baseNode({ id: '-goal-launch' }));
    expect(result.valid).toBe(false);
  });

  it('id MUST be kebab-case — accepts valid kebab', () => {
    expect(validate(baseNode({ id: 'goal-launch-v1' })).valid).toBe(true);
    expect(validate(baseNode({ id: 'task-123' })).valid).toBe(true);
    expect(validate(baseNode({ id: 'fact' })).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 3.2 — Required frontmatter fields
// ---------------------------------------------------------------------------

describe('section 3.2 — required fields present', () => {
  const requiredFields: Array<keyof MskNode> = [
    'id', 'type', 'layer', 'status', 'confidence',
    'created_by', 'created_at', 'last_updated_by', 'last_updated_at',
    'dependencies', 'contradictions',
  ];

  for (const field of requiredFields) {
    it(`rejects node missing ${field}`, () => {
      const node = baseNode();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const partial = { ...node } as any;
      delete partial[field];
      expect(validate(partial).valid).toBe(false);
    });
  }
});

describe('section 3.2 — type enum', () => {
  const validTypes = ['goal', 'task', 'decision', 'constraint', 'issue', 'fact'] as const;

  for (const t of validTypes) {
    it(`accepts type: ${t}`, () => {
      expect(validate(baseNode({ type: t })).valid).toBe(true);
    });
  }

  it('rejects unknown type', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(validate(baseNode({ type: 'bug' as any })).valid).toBe(false);
  });
});

describe('section 3.2 — layer enum', () => {
  const validLayers = ['intent', 'state', 'knowledge', 'issues'] as const;

  for (const l of validLayers) {
    it(`accepts layer: ${l}`, () => {
      expect(validate(baseNode({ layer: l })).valid).toBe(true);
    });
  }

  it('rejects unknown layer', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(validate(baseNode({ layer: 'archive' as any })).valid).toBe(false);
  });
});

describe('section 3.2 — status enum', () => {
  const validStatuses = ['active', 'resolved', 'deprecated', 'draft'] as const;

  for (const s of validStatuses) {
    it(`accepts status: ${s}`, () => {
      expect(validate(baseNode({ status: s })).valid).toBe(true);
    });
  }

  it('rejects unknown status', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(validate(baseNode({ status: 'closed' as any })).valid).toBe(false);
  });
});

describe('section 3.2 — confidence bounds', () => {
  it('accepts 0.0', () => expect(validate(baseNode({ confidence: 0.0 })).valid).toBe(true));
  it('accepts 0.6 (agent-inferred)', () => expect(validate(baseNode({ confidence: 0.6 })).valid).toBe(true));
  it('accepts 1.0 (human-set)', () => expect(validate(baseNode({ confidence: 1.0 })).valid).toBe(true));
  it('rejects > 1.0', () => expect(validate(baseNode({ confidence: 1.1 })).valid).toBe(false));
  it('rejects < 0.0', () => expect(validate(baseNode({ confidence: -0.1 })).valid).toBe(false));
});

describe('section 3.2 — ISO 8601 timestamps', () => {
  it('accepts datetime with Z suffix', () => {
    expect(validate(baseNode({ created_at: '2026-05-12T00:00:00Z' })).valid).toBe(true);
  });

  it('accepts datetime with milliseconds', () => {
    expect(validate(baseNode({ created_at: '2026-05-12T00:00:00.000Z' })).valid).toBe(true);
  });

  it('accepts datetime with timezone offset', () => {
    expect(validate(baseNode({ created_at: '2026-05-12T00:00:00+05:30' })).valid).toBe(true);
  });

  it('rejects date-only string', () => {
    expect(validate(baseNode({ created_at: '2026-05-12' })).valid).toBe(false);
  });

  it('rejects non-date string', () => {
    expect(validate(baseNode({ created_at: 'now' })).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 3.2 — Optional fields
// ---------------------------------------------------------------------------

describe('section 3.2 — optional fields', () => {
  it('node without optional fields is valid', () => {
    expect(validate(baseNode()).valid).toBe(true);
  });

  it('accepts tags array', () => {
    expect(validate(baseNode({ tags: ['launch', 'npm'] })).valid).toBe(true);
  });

  it('accepts scanned: true', () => {
    expect(validate(baseNode({ scanned: true })).valid).toBe(true);
  });

  it('accepts verified: false', () => {
    expect(validate(baseNode({ verified: false })).valid).toBe(true);
  });

  it('accepts expires_at as ISO 8601 datetime', () => {
    expect(validate(baseNode({ expires_at: '2026-06-01T00:00:00Z' })).valid).toBe(true);
  });

  it('rejects expires_at as date-only', () => {
    expect(validate(baseNode({ expires_at: '2026-06-01' })).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 3.3 — Body content round-trip
// ---------------------------------------------------------------------------

describe('section 3.3 — body content', () => {
  it('body is preserved exactly on write/read round-trip (non-state layer)', async () => {
    const body = 'Ship @mastishk/cli to npm.\nTarget: 100 stars.';
    const node = baseNode({ body });
    const filePath = join(tmpDir, 'intent', 'goal-launch-v1.msk.md');
    await writeNode(filePath, node);
    const read = await readNode(filePath);
    expect(read.body.trim()).toBe(body);
  });

  it('readNode throws MskReadError for file with missing required field', async () => {
    const filePath = join(tmpDir, 'bad.msk.md');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(filePath, '---\nid: test\n---\nMissing most required fields.\n', 'utf-8');
    await expect(readNode(filePath)).rejects.toBeInstanceOf(MskReadError);
  });

  it('MskReadError has filePath and validationErrors properties', async () => {
    const filePath = join(tmpDir, 'bad2.msk.md');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(filePath, '---\nid: test\n---\nBad.\n', 'utf-8');
    try {
      await readNode(filePath);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(MskReadError);
      const err = e as MskReadError;
      expect(err.filePath).toBe(filePath);
      expect(Array.isArray(err.validationErrors)).toBe(true);
      expect(err.validationErrors.length).toBeGreaterThan(0);
    }
  });
});
