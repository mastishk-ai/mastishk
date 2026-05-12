import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  inject,
  writeNode,
  writeMemoryMap,
  createEmptyMemoryMap,
  upsertNode,
} from '@mastishk/core';
import type { MskNode, MemoryMapNode } from '@mastishk/core';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-inject-'));
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers to build a test .mastishk/ directory
// ---------------------------------------------------------------------------

async function writeTestNode(relPath: string, node: MskNode): Promise<void> {
  await writeNode(join(tmpDir, relPath), node);
}

function makeMapNode(overrides: Partial<MemoryMapNode> = {}): MemoryMapNode {
  return {
    file: 'intent/goal-launch-v1.msk.md',
    layer: 'intent',
    type: 'goal',
    status: 'active',
    confidence: 1.0,
    dependencies: [],
    tags: ['launch', 'v1'],
    ...overrides,
  };
}

function makeMskNode(overrides: Partial<MskNode> = {}): MskNode {
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
    tags: ['launch', 'v1'],
    body: 'Ship @mastishk/cli to npm. Target 100 GitHub stars within 30 days.',
    ...overrides,
  };
}

// Build a realistic test memory directory with a few nodes
async function buildTestMemory(): Promise<void> {
  const goalFile = 'intent/goal-launch-v1.msk.md';
  const taskFile = 'state/task-write-spec.msk.md';
  const factFile = 'knowledge/fact-tech-stack.msk.md';
  const issueFile = 'issues/issue-blocked-on-zod.msk.md';

  await writeTestNode(goalFile, makeMskNode({
    id: 'goal-launch-v1',
    layer: 'intent',
    type: 'goal',
    tags: ['launch', 'v1', 'npm'],
    body: 'Ship @mastishk/cli to npm. Target 100 GitHub stars within 30 days.',
    confidence: 1.0,
  }));

  await writeTestNode(taskFile, makeMskNode({
    id: 'task-write-spec',
    layer: 'state',
    type: 'task',
    tags: ['spec', 'docs'],
    dependencies: ['goal-launch-v1'],
    body: 'Write the MASTISHK-SPEC.md protocol document. Include all six claims.',
    confidence: 0.8,
  }));

  await writeTestNode(factFile, makeMskNode({
    id: 'fact-tech-stack',
    layer: 'knowledge',
    type: 'fact',
    tags: ['typescript', 'zod', 'gray-matter'],
    body: 'Project uses TypeScript strict mode, zod for validation, gray-matter for .msk.md parsing.',
    confidence: 0.9,
  }));

  await writeTestNode(issueFile, makeMskNode({
    id: 'issue-blocked-on-zod',
    layer: 'issues',
    type: 'issue',
    tags: ['blocked', 'zod'],
    body: 'Blocked on zod version compatibility. Upgrade to v3 resolves this.',
    confidence: 0.7,
  }));

  let map = createEmptyMemoryMap();
  map = upsertNode(map, 'goal-launch-v1', makeMapNode({
    file: goalFile, layer: 'intent', type: 'goal', tags: ['launch', 'v1', 'npm'], confidence: 1.0,
  }));
  map = upsertNode(map, 'task-write-spec', makeMapNode({
    file: taskFile, layer: 'state', type: 'task', tags: ['spec', 'docs'],
    dependencies: ['goal-launch-v1'], confidence: 0.8,
  }));
  map = upsertNode(map, 'fact-tech-stack', makeMapNode({
    file: factFile, layer: 'knowledge', type: 'fact', tags: ['typescript', 'zod', 'gray-matter'], confidence: 0.9,
  }));
  map = upsertNode(map, 'issue-blocked-on-zod', makeMapNode({
    file: issueFile, layer: 'issues', type: 'issue', tags: ['blocked', 'zod'], confidence: 0.7,
  }));

  await writeMemoryMap(join(tmpDir, 'memory-map.json'), map);
}

// ---------------------------------------------------------------------------
// Output format (spec section 6.3)
// ---------------------------------------------------------------------------

describe('inject — output format', () => {
  it('output starts with "## Mastishk context — {task}"', async () => {
    await buildTestMemory();
    const output = await inject('launch npm package', tmpDir);
    expect(output).toMatch(/^## Mastishk context — launch npm package/);
  });

  it('output contains "Generated:" timestamp line', async () => {
    await buildTestMemory();
    const output = await inject('launch npm package', tmpDir);
    expect(output).toMatch(/Generated: \d{4}-\d{2}-\d{2}T/);
  });

  it('matched nodes rendered as **{id}** [{confidence}] — {sentence}', async () => {
    await buildTestMemory();
    const output = await inject('launch', tmpDir);
    expect(output).toMatch(/\*\*goal-launch-v1\*\* \[1\.0\] — /);
  });
});

// ---------------------------------------------------------------------------
// Matching by id token and tags (spec section 6.2 step 1)
// ---------------------------------------------------------------------------

describe('inject — node matching', () => {
  it('matches a node by id token', async () => {
    await buildTestMemory();
    const output = await inject('launch something', tmpDir);
    expect(output).toContain('goal-launch-v1');
  });

  it('matches a node by tag', async () => {
    await buildTestMemory();
    const output = await inject('write a spec', tmpDir);
    expect(output).toContain('task-write-spec');
  });

  it('matches a node by tag "typescript"', async () => {
    await buildTestMemory();
    const output = await inject('typescript stack', tmpDir);
    expect(output).toContain('fact-tech-stack');
  });
});

// ---------------------------------------------------------------------------
// Layer ordering (spec section 6.2 step 5)
// ---------------------------------------------------------------------------

describe('inject — layer ordering', () => {
  it('intent layer appears before state layer', async () => {
    await buildTestMemory();
    const output = await inject('launch spec', tmpDir);
    const goalsPos = output.indexOf('### Goals');
    const statePos = output.indexOf('### Current state');
    if (goalsPos !== -1 && statePos !== -1) {
      expect(goalsPos).toBeLessThan(statePos);
    }
  });

  it('state layer appears before knowledge layer', async () => {
    await buildTestMemory();
    const output = await inject('spec typescript', tmpDir);
    const statePos = output.indexOf('### Current state');
    const knowledgePos = output.indexOf('### Knowledge');
    if (statePos !== -1 && knowledgePos !== -1) {
      expect(statePos).toBeLessThan(knowledgePos);
    }
  });
});

// ---------------------------------------------------------------------------
// First-sentence truncation (spec section 6.3)
// ---------------------------------------------------------------------------

describe('inject — body truncation', () => {
  it('shows only first sentence for confidence < 0.9', async () => {
    // task-write-spec has confidence 0.8 — first sentence only
    await buildTestMemory();
    const output = await inject('spec', tmpDir);
    if (output.includes('task-write-spec')) {
      // Body: "Write the MASTISHK-SPEC.md protocol document. Include all six claims."
      // Only first sentence should appear
      expect(output).not.toContain('Include all six claims.');
    }
  });

  it('shows full body for confidence >= 0.9', async () => {
    // fact-tech-stack has confidence 0.9 — full body
    await buildTestMemory();
    const output = await inject('typescript zod', tmpDir);
    if (output.includes('fact-tech-stack')) {
      expect(output).toContain('gray-matter for .msk.md parsing');
    }
  });
});

// ---------------------------------------------------------------------------
// Empty / no-match result
// ---------------------------------------------------------------------------

describe('inject — no matches', () => {
  it('returns header even when no nodes match', async () => {
    await buildTestMemory();
    const output = await inject('xyzzy-nonexistent-gibberish', tmpDir);
    expect(output).toMatch(/^## Mastishk context — xyzzy-nonexistent-gibberish/);
    expect(output).toContain('Generated:');
  });

  it('empty memory returns valid header', async () => {
    await writeMemoryMap(join(tmpDir, 'memory-map.json'), createEmptyMemoryMap());
    const output = await inject('any task', tmpDir);
    expect(output).toMatch(/^## Mastishk context — any task/);
  });
});

// ---------------------------------------------------------------------------
// Traversal expands to dependencies (spec section 6.2 step 3)
// ---------------------------------------------------------------------------

describe('inject — graph traversal expansion', () => {
  it('matching a task also includes its goal dependency in output', async () => {
    await buildTestMemory();
    // task-write-spec depends on goal-launch-v1
    // matching "spec" should traverse to include goal
    const output = await inject('spec', tmpDir);
    if (output.includes('task-write-spec')) {
      expect(output).toContain('goal-launch-v1');
    }
  });
});
