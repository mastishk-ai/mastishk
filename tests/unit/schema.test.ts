import { describe, it, expect } from 'vitest';
import { validate, MskNodeSchema } from '@mastishk/core';

// Example node from MASTISHK-SPEC.md section 3.4
const exampleNode = {
  id: 'goal-launch-v1',
  type: 'goal',
  layer: 'intent',
  status: 'active',
  confidence: 1.0,
  created_by: 'human',
  created_at: '2026-05-12T00:00:00Z',
  last_updated_by: 'human',
  last_updated_at: '2026-05-12T00:00:00Z',
  dependencies: [],
  contradictions: [],
  tags: ['launch', 'v1', 'npm'],
  body: 'Ship @mastishk/cli to npm and submit the arXiv paper before June 2026.\nTarget: 100 GitHub stars within 30 days of launch.',
};

describe('validate — spec section 3.4 example node', () => {
  it('passes for the canonical example node', () => {
    const result = validate(exampleNode);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('validate — all valid type values (spec section 3.2)', () => {
  const types = ['goal', 'task', 'decision', 'constraint', 'issue', 'fact'] as const;
  for (const type of types) {
    it(`accepts type: ${type}`, () => {
      expect(validate({ ...exampleNode, type }).valid).toBe(true);
    });
  }
});

describe('validate — all valid layer values (spec section 3.2)', () => {
  const layers = ['intent', 'state', 'knowledge', 'issues'] as const;
  for (const layer of layers) {
    it(`accepts layer: ${layer}`, () => {
      expect(validate({ ...exampleNode, layer }).valid).toBe(true);
    });
  }
});

describe('validate — all valid status values (spec section 3.2)', () => {
  const statuses = ['active', 'resolved', 'deprecated', 'draft'] as const;
  for (const status of statuses) {
    it(`accepts status: ${status}`, () => {
      expect(validate({ ...exampleNode, status }).valid).toBe(true);
    });
  }
});

describe('validate — required fields (spec section 3.2)', () => {
  const requiredFields = [
    'id',
    'type',
    'layer',
    'status',
    'confidence',
    'created_by',
    'created_at',
    'last_updated_by',
    'last_updated_at',
    'dependencies',
    'contradictions',
    'body',
  ] as const;

  for (const field of requiredFields) {
    it(`fails with clear error when ${field} is missing`, () => {
      const node = { ...exampleNode } as Record<string, unknown>;
      delete node[field];
      const result = validate(node);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes(field))).toBe(true);
    });
  }
});

describe('validate — confidence bounds (spec section 3.2)', () => {
  it('accepts confidence: 0.0', () => {
    expect(validate({ ...exampleNode, confidence: 0.0 }).valid).toBe(true);
  });

  it('accepts confidence: 0.6 (agent-inferred)', () => {
    expect(validate({ ...exampleNode, confidence: 0.6 }).valid).toBe(true);
  });

  it('accepts confidence: 1.0 (human-set)', () => {
    expect(validate({ ...exampleNode, confidence: 1.0 }).valid).toBe(true);
  });

  it('rejects confidence > 1.0', () => {
    const result = validate({ ...exampleNode, confidence: 1.1 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('confidence'))).toBe(true);
  });

  it('rejects confidence < 0.0', () => {
    const result = validate({ ...exampleNode, confidence: -0.1 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('confidence'))).toBe(true);
  });
});

describe('validate — invalid enum values', () => {
  it('rejects unknown type', () => {
    const result = validate({ ...exampleNode, type: 'unknown' });
    expect(result.valid).toBe(false);
  });

  it('rejects unknown layer', () => {
    const result = validate({ ...exampleNode, layer: 'archive' });
    expect(result.valid).toBe(false);
  });

  it('rejects unknown status', () => {
    const result = validate({ ...exampleNode, status: 'pending' });
    expect(result.valid).toBe(false);
  });
});

describe('validate — id format (spec section 3.1)', () => {
  it('accepts valid kebab-case ids', () => {
    expect(validate({ ...exampleNode, id: 'task-write-spec' }).valid).toBe(true);
    expect(validate({ ...exampleNode, id: 'fact-1' }).valid).toBe(true);
    expect(validate({ ...exampleNode, id: 'decision-use-zod-v3' }).valid).toBe(true);
  });

  it('rejects ids with uppercase letters', () => {
    expect(validate({ ...exampleNode, id: 'Goal-Launch' }).valid).toBe(false);
  });

  it('rejects ids with spaces', () => {
    expect(validate({ ...exampleNode, id: 'goal launch' }).valid).toBe(false);
  });
});

describe('validate — datetime fields (spec section 3.2)', () => {
  it('rejects date-only created_at (not ISO 8601 datetime)', () => {
    const result = validate({ ...exampleNode, created_at: '2026-05-12' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('created_at'))).toBe(true);
  });

  it('rejects non-date string', () => {
    const result = validate({ ...exampleNode, last_updated_at: 'not-a-date' });
    expect(result.valid).toBe(false);
  });

  it('accepts datetime with milliseconds', () => {
    expect(validate({ ...exampleNode, created_at: '2026-05-12T00:00:00.000Z' }).valid).toBe(true);
  });

  it('accepts datetime with offset timezone', () => {
    expect(validate({ ...exampleNode, created_at: '2026-05-12T00:00:00+05:30' }).valid).toBe(true);
  });
});

describe('validate — optional fields (spec section 3.2)', () => {
  it('accepts node without optional fields', () => {
    const { tags, ...nodeWithout } = exampleNode;
    expect(validate(nodeWithout).valid).toBe(true);
  });

  it('accepts scanned: true', () => {
    expect(validate({ ...exampleNode, scanned: true }).valid).toBe(true);
  });

  it('accepts verified: false', () => {
    expect(validate({ ...exampleNode, verified: false }).valid).toBe(true);
  });

  it('accepts expires_at as valid ISO 8601', () => {
    expect(validate({ ...exampleNode, expires_at: '2026-12-31T00:00:00Z' }).valid).toBe(true);
  });

  it('rejects expires_at as date-only string', () => {
    const result = validate({ ...exampleNode, expires_at: '2026-12-31' });
    expect(result.valid).toBe(false);
  });
});

describe('validate — non-object inputs', () => {
  it('rejects null', () => {
    expect(validate(null).valid).toBe(false);
  });

  it('rejects a string', () => {
    expect(validate('not-a-node').valid).toBe(false);
  });

  it('rejects an empty object', () => {
    expect(validate({}).valid).toBe(false);
  });
});
