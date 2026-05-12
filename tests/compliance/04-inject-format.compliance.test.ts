/**
 * Compliance suite — Section 6: The inject interface
 *
 * Tests that inject() produces output conforming exactly to spec section 6.3:
 * - Output header format
 * - Section headers present
 * - Node rendering format
 * - Confidence >= 0.9 shows full body; < 0.9 shows first sentence only
 * - Token budget enforced (low-confidence nodes dropped first)
 * - Nodes sorted: intent → state → knowledge → issues
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeNode, writeMemoryMap, upsertNode, createEmptyMemoryMap, inject } from '@mastishk/core';
import type { MskNode, MemoryMapNode } from '@mastishk/core';

let tmpDir: string;
let mastishkDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-c04-'));
  mastishkDir = join(tmpDir, '.mastishk');
});
afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

const NOW = '2026-05-12T00:00:00.000Z';

function mkNode(id: string, overrides: Partial<MskNode> = {}): MskNode {
  return {
    id,
    type: 'goal',
    layer: 'intent',
    status: 'active',
    confidence: 1.0,
    created_by: 'human',
    created_at: NOW,
    last_updated_by: 'human',
    last_updated_at: NOW,
    dependencies: [],
    contradictions: [],
    body: 'Default body text for testing.',
    ...overrides,
  };
}

async function seedNode(id: string, node: MskNode, mapEntry: Partial<MemoryMapNode> = {}): Promise<void> {
  const layer = node.layer;
  const filePath = join(mastishkDir, layer, `${id}.msk.md`);
  await writeNode(filePath, node);

  const existingMap = await (async () => {
    try {
      const { readMemoryMap } = await import('@mastishk/core');
      return await readMemoryMap(join(mastishkDir, 'memory-map.json'));
    } catch {
      return createEmptyMemoryMap();
    }
  })();

  const entry: MemoryMapNode = {
    file: `${layer}/${id}.msk.md`,
    layer: node.layer,
    type: node.type,
    status: node.status,
    confidence: node.confidence,
    dependencies: node.dependencies,
    tags: node.tags,
    ...mapEntry,
  };
  await writeMemoryMap(
    join(mastishkDir, 'memory-map.json'),
    upsertNode(existingMap, id, entry)
  );
}

// ---------------------------------------------------------------------------
// Section 6.3 — Output format
// ---------------------------------------------------------------------------

describe('section 6.3 — inject output header', () => {
  it('output starts with "## Mastishk context — {task}"', async () => {
    await writeMemoryMap(join(mastishkDir, 'memory-map.json'), createEmptyMemoryMap());
    const result = await inject('ship npm package', mastishkDir);
    expect(result).toMatch(/^## Mastishk context — ship npm package/);
  });

  it('output contains "Generated:" line with ISO timestamp', async () => {
    await writeMemoryMap(join(mastishkDir, 'memory-map.json'), createEmptyMemoryMap());
    const result = await inject('any task', mastishkDir);
    expect(result).toContain('Generated:');
    expect(result).toMatch(/Generated: \d{4}-\d{2}-\d{2}T/);
  });

  it('output contains section headers for populated layers', async () => {
    // Sections only appear when there are matching nodes in that layer (empty sections omitted)
    await seedNode('goal-hdr', mkNode('goal-hdr', { tags: ['hdr'], layer: 'intent', type: 'goal' }));
    await seedNode('task-hdr', mkNode('task-hdr', { tags: ['hdr'], layer: 'state', type: 'task', body: 'State.' }));
    const result = await inject('hdr', mastishkDir);
    expect(result).toContain('### Goals');
    expect(result).toContain('### Current state');
  });
});

describe('section 6.3 — node rendering format', () => {
  it('matched node renders as "**{id}** [{confidence}] — {text}"', async () => {
    await seedNode('goal-launch-v1', mkNode('goal-launch-v1', {
      tags: ['launch'],
      body: 'Ship the product.',
      confidence: 1.0,
    }));
    const result = await inject('launch', mastishkDir);
    // confidence rendered with toFixed(1): 1.0 → "1.0"
    expect(result).toMatch(/\*\*goal-launch-v1\*\* \[1\.0\] — /);
  });

  it('confidence shown as decimal in brackets', async () => {
    await seedNode('goal-conf', mkNode('goal-conf', {
      tags: ['test'],
      body: 'Test body.',
      confidence: 0.8,
    }));
    const result = await inject('test', mastishkDir);
    expect(result).toMatch(/\[0\.8\]/);
  });
});

describe('section 6.3 — first sentence truncation rule', () => {
  it('confidence < 0.9 shows only first sentence of body', async () => {
    const body = 'First sentence. Second sentence should not appear.';
    await seedNode('goal-low', mkNode('goal-low', {
      tags: ['truncate'],
      body,
      confidence: 0.8,
    }));
    const result = await inject('truncate', mastishkDir);
    expect(result).toContain('First sentence.');
    expect(result).not.toContain('Second sentence should not appear.');
  });

  it('confidence >= 0.9 shows full body', async () => {
    const body = 'First sentence. Second sentence must appear too.';
    await seedNode('goal-high', mkNode('goal-high', {
      tags: ['fullbody'],
      body,
      confidence: 0.9,
    }));
    const result = await inject('fullbody', mastishkDir);
    expect(result).toContain('First sentence.');
    expect(result).toContain('Second sentence must appear too.');
  });
});

describe('section 6.3 — layer ordering', () => {
  it('intent section appears before state section', async () => {
    await seedNode('goal-a', mkNode('goal-a', { tags: ['ordering'], layer: 'intent', type: 'goal' }));
    await seedNode('task-b', mkNode('task-b', {
      tags: ['ordering'], layer: 'state', type: 'task', body: 'State body.'
    }));
    const result = await inject('ordering', mastishkDir);
    const goalPos = result.indexOf('goal-a');
    const taskPos = result.indexOf('task-b');
    expect(goalPos).toBeLessThan(taskPos);
  });

  it('state section appears before knowledge section', async () => {
    await seedNode('task-x', mkNode('task-x', { tags: ['ordering2'], layer: 'state', type: 'task', body: 'State.' }));
    await seedNode('fact-x', mkNode('fact-x', { tags: ['ordering2'], layer: 'knowledge', type: 'fact', body: 'Knowledge.' }));
    const result = await inject('ordering2', mastishkDir);
    const taskPos = result.indexOf('task-x');
    const factPos = result.indexOf('fact-x');
    expect(taskPos).toBeLessThan(factPos);
  });
});

describe('section 6.2 — active-only filter', () => {
  it('resolved nodes are not included in inject output', async () => {
    await seedNode('goal-resolved', mkNode('goal-resolved', {
      tags: ['resolved-test'],
      status: 'resolved',
    }));
    const result = await inject('resolved-test', mastishkDir);
    expect(result).not.toContain('goal-resolved');
  });

  it('active nodes ARE included', async () => {
    await seedNode('goal-active', mkNode('goal-active', {
      tags: ['active-test'],
      status: 'active',
    }));
    const result = await inject('active-test', mastishkDir);
    expect(result).toContain('goal-active');
  });
});

describe('section 6.2 — confidence filter', () => {
  it('nodes with confidence < 0.5 are excluded', async () => {
    await seedNode('goal-lowconf', mkNode('goal-lowconf', {
      tags: ['lowconf'],
      confidence: 0.4,
    }));
    const result = await inject('lowconf', mastishkDir);
    expect(result).not.toContain('goal-lowconf');
  });

  it('nodes with confidence exactly 0.5 are included', async () => {
    await seedNode('goal-threshold', mkNode('goal-threshold', {
      tags: ['threshold'],
      confidence: 0.5,
    }));
    const result = await inject('threshold', mastishkDir);
    expect(result).toContain('goal-threshold');
  });
});

describe('section 6.2 — empty result', () => {
  it('returns header even when no nodes match', async () => {
    await writeMemoryMap(join(mastishkDir, 'memory-map.json'), createEmptyMemoryMap());
    const result = await inject('xyzzy-gibberish-no-match', mastishkDir);
    expect(result).toMatch(/^## Mastishk context — xyzzy-gibberish-no-match/);
  });
});
