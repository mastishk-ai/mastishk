import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  writeNode,
  writeMemoryMap,
  readMemoryMap,
  readNode,
  createEmptyMemoryMap,
  upsertNode,
} from '@mastishk/core';
import type { MskNode, MemoryMapNode } from '@mastishk/core';
import { initCommand } from '../../src/packages/cli/src/commands/init.js';
import {
  TOOL_DEFINITIONS,
  toolInject,
  toolUpdate,
  toolLog,
  toolStatus,
  toolCheckpoint,
} from '../../src/packages/mcp/src/tools.js';

let tmpDir: string;
let ctx: { mastishkDir: string };

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-mcp-'));
  ctx = { mastishkDir: join(tmpDir, '.mastishk') };
  await initCommand({ cwd: tmpDir });
});
afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseMskNode(overrides: Partial<MskNode> = {}): MskNode {
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
    body: 'Ship @mastishk/cli to npm. Target 100 stars.',
    ...overrides,
  };
}

async function seedMemory(): Promise<void> {
  const goalFile = join(ctx.mastishkDir, 'intent', 'goal-launch-v1.msk.md');
  const taskFile = join(ctx.mastishkDir, 'state', 'task-write-spec.msk.md');

  await writeNode(goalFile, baseMskNode());
  await writeNode(taskFile, baseMskNode({
    id: 'task-write-spec', type: 'task', layer: 'state',
    tags: ['spec'], dependencies: ['goal-launch-v1'],
    body: 'Write the protocol spec. Include all six claims.', confidence: 0.8,
  }));

  let map = createEmptyMemoryMap();
  map = upsertNode(map, 'goal-launch-v1', {
    file: 'intent/goal-launch-v1.msk.md', layer: 'intent', type: 'goal',
    status: 'active', confidence: 1.0, dependencies: [], tags: ['launch', 'v1'],
  } as MemoryMapNode);
  map = upsertNode(map, 'task-write-spec', {
    file: 'state/task-write-spec.msk.md', layer: 'state', type: 'task',
    status: 'active', confidence: 0.8, dependencies: ['goal-launch-v1'], tags: ['spec'],
  } as MemoryMapNode);
  await writeMemoryMap(join(ctx.mastishkDir, 'memory-map.json'), map);
}

// ---------------------------------------------------------------------------
// Tool definitions (spec section 9)
// ---------------------------------------------------------------------------

describe('TOOL_DEFINITIONS — spec section 9', () => {
  const required = ['mastishk_inject', 'mastishk_update', 'mastishk_log', 'mastishk_status', 'mastishk_checkpoint'];

  it('exposes all five required tools', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    for (const name of required) {
      expect(names).toContain(name);
    }
  });

  it('every tool has a non-empty description', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('mastishk_inject has required param: task', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_inject')!;
    expect(t.inputSchema.required).toContain('task');
  });

  it('mastishk_update has required params: id, content, layer', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_update')!;
    expect(t.inputSchema.required).toContain('id');
    expect(t.inputSchema.required).toContain('content');
    expect(t.inputSchema.required).toContain('layer');
  });

  it('mastishk_log has required param: message', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_log')!;
    expect(t.inputSchema.required).toContain('message');
  });

  it('mastishk_status has no required params', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_status')!;
    expect(t.inputSchema.required).toHaveLength(0);
  });

  it('mastishk_checkpoint has no required params', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_checkpoint')!;
    expect(t.inputSchema.required).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// toolInject (spec section 9)
// ---------------------------------------------------------------------------

describe('toolInject', () => {
  it('returns inject output string matching spec section 6.3 format', async () => {
    await seedMemory();
    const result = await toolInject({ task: 'launch npm package' }, ctx);
    expect(result).toMatch(/^## Mastishk context — launch npm package/);
    expect(result).toContain('Generated:');
  });

  it('matching node appears in output', async () => {
    await seedMemory();
    const result = await toolInject({ task: 'launch' }, ctx);
    expect(result).toContain('goal-launch-v1');
  });

  it('returns header even with no matches', async () => {
    const result = await toolInject({ task: 'xyzzy-gibberish' }, ctx);
    expect(result).toMatch(/^## Mastishk context/);
  });
});

// ---------------------------------------------------------------------------
// toolUpdate (spec section 9)
// ---------------------------------------------------------------------------

describe('toolUpdate — create new node', () => {
  it('creates a new intent node when id does not exist', async () => {
    const result = await toolUpdate({ id: 'goal-new-feature', content: 'Build the thing.', layer: 'intent' }, ctx);
    expect(result).toContain('Created');
    expect(result).toContain('goal-new-feature');

    const node = await readNode(join(ctx.mastishkDir, 'intent', 'goal-new-feature.msk.md'));
    expect(node.id).toBe('goal-new-feature');
    expect(node.layer).toBe('intent');
    expect(node.type).toBe('goal');
    expect(node.body).toContain('Build the thing.');
  });

  it('created node is added to memory-map.json', async () => {
    await toolUpdate({ id: 'fact-stack-choice', content: 'Using TypeScript.', layer: 'knowledge' }, ctx);
    const map = await readMemoryMap(join(ctx.mastishkDir, 'memory-map.json'));
    expect(map.nodes['fact-stack-choice']).toBeDefined();
    expect(map.nodes['fact-stack-choice'].layer).toBe('knowledge');
  });

  it('infers type=task for state layer', async () => {
    await toolUpdate({ id: 'task-build-mcp', content: 'Build the MCP server.', layer: 'state' }, ctx);
    const node = await readNode(join(ctx.mastishkDir, 'state', 'task-build-mcp.msk.md'));
    expect(node.type).toBe('task');
  });

  it('infers type=issue for issues layer', async () => {
    await toolUpdate({ id: 'issue-blocked', content: 'Blocked on deps.', layer: 'issues' }, ctx);
    const node = await readNode(join(ctx.mastishkDir, 'issues', 'issue-blocked.msk.md'));
    expect(node.type).toBe('issue');
  });

  it('agent-created nodes have confidence 0.7', async () => {
    await toolUpdate({ id: 'goal-new', content: 'New goal.', layer: 'intent' }, ctx);
    const node = await readNode(join(ctx.mastishkDir, 'intent', 'goal-new.msk.md'));
    expect(node.confidence).toBe(0.7);
  });
});

describe('toolUpdate — update existing node', () => {
  it('replaces body on intent layer node', async () => {
    await seedMemory();
    await toolUpdate({ id: 'goal-launch-v1', content: 'New goal body.', layer: 'intent' }, ctx);
    const node = await readNode(join(ctx.mastishkDir, 'intent', 'goal-launch-v1.msk.md'));
    expect(node.body).toBe('New goal body.');
  });

  it('appends content to state layer node (spec section 7.2)', async () => {
    await seedMemory();
    await toolUpdate({ id: 'task-write-spec', content: 'Progress update.', layer: 'state' }, ctx);
    const node = await readNode(join(ctx.mastishkDir, 'state', 'task-write-spec.msk.md'));
    expect(node.body).toContain('Write the protocol spec.');
    expect(node.body).toContain('Progress update.');
  });

  it('returns "Updated" in result for existing node', async () => {
    await seedMemory();
    const result = await toolUpdate({ id: 'goal-launch-v1', content: 'Updated.', layer: 'intent' }, ctx);
    expect(result).toContain('Updated');
  });
});

// ---------------------------------------------------------------------------
// toolLog (spec section 9)
// ---------------------------------------------------------------------------

describe('toolLog', () => {
  it('creates an issue node and returns id in message', async () => {
    const result = await toolLog({ message: 'Zod version conflict.' }, ctx);
    expect(result).toContain('issue-');
    expect(result).toContain('Zod version conflict.');
  });

  it('issue node has correct fields', async () => {
    const result = await toolLog({ message: 'Build failed.' }, ctx);
    const id = result.match(/issue-\d+/)?.[0] ?? '';
    const node = await readNode(join(ctx.mastishkDir, `issues/${id}.msk.md`));
    expect(node.type).toBe('issue');
    expect(node.layer).toBe('issues');
    expect(node.status).toBe('active');
    expect(node.body).toContain('Build failed.');
  });

  it('adds node to memory-map.json', async () => {
    const result = await toolLog({ message: 'Some error.' }, ctx);
    const id = result.match(/issue-\d+/)?.[0] ?? '';
    const map = await readMemoryMap(join(ctx.mastishkDir, 'memory-map.json'));
    expect(map.nodes[id]).toBeDefined();
  });

  it('type param is added as tag', async () => {
    const result = await toolLog({ message: 'Critical failure.', type: 'error' }, ctx);
    const id = result.match(/issue-\d+/)?.[0] ?? '';
    const node = await readNode(join(ctx.mastishkDir, `issues/${id}.msk.md`));
    expect(node.tags).toContain('error');
  });

  it('without type no error tag', async () => {
    const result = await toolLog({ message: 'Minor note.' }, ctx);
    const id = result.match(/issue-\d+/)?.[0] ?? '';
    const node = await readNode(join(ctx.mastishkDir, `issues/${id}.msk.md`));
    expect(node.tags ?? []).not.toContain('error');
  });
});

// ---------------------------------------------------------------------------
// toolStatus (spec section 9)
// ---------------------------------------------------------------------------

describe('toolStatus', () => {
  it('returns total node count', async () => {
    await seedMemory();
    const result = await toolStatus({} as Record<string, never>, ctx);
    expect(result).toContain('Total nodes: 2');
  });

  it('shows "none" for open issues when no issues exist', async () => {
    const result = await toolStatus({} as Record<string, never>, ctx);
    expect(result).toContain('Open issues: none');
  });

  it('lists open issue ids', async () => {
    const logResult = await toolLog({ message: 'Test issue.' }, ctx);
    const id = logResult.match(/issue-\d+/)?.[0] ?? '';
    const statusResult = await toolStatus({} as Record<string, never>, ctx);
    expect(statusResult).toContain(id);
  });

  it('returns last updated timestamp', async () => {
    const result = await toolStatus({} as Record<string, never>, ctx);
    expect(result).toContain('Last updated:');
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// toolCheckpoint (spec section 9)
// ---------------------------------------------------------------------------

describe('toolCheckpoint', () => {
  it('throws a descriptive error on non-git directory', async () => {
    // tmpDir is not a git repo — checkpoint must fail with a clear message
    await expect(toolCheckpoint({}, ctx)).rejects.toThrow('Git checkpoint failed');
  });
});
