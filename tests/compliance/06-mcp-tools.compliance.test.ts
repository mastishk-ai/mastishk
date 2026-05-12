/**
 * Compliance suite — Section 9: MCP tool interface
 *
 * Tests that the MCP server exposes exactly the five required tools with:
 * - Correct names
 * - Non-trivial descriptions (first-time agent discovery)
 * - Correct required parameter lists
 * - Functional tool handlers
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  TOOL_DEFINITIONS,
  toolInject,
  toolUpdate,
  toolLog,
  toolStatus,
  toolCheckpoint,
} from '../../src/packages/mcp/src/tools.js';
import { initCommand } from '../../src/packages/cli/src/commands/init.js';

let tmpDir: string;
let ctx: { mastishkDir: string };

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-c06-'));
  ctx = { mastishkDir: join(tmpDir, '.mastishk') };
  await initCommand({ cwd: tmpDir });
});
afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------
// Section 9 — Tool presence and names
// ---------------------------------------------------------------------------

describe('section 9 — required tool names', () => {
  const required = [
    'mastishk_inject',
    'mastishk_update',
    'mastishk_log',
    'mastishk_status',
    'mastishk_checkpoint',
  ];

  it('exposes exactly 5 tools', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(5);
  });

  for (const name of required) {
    it(`exposes tool: ${name}`, () => {
      const names = TOOL_DEFINITIONS.map((t) => t.name);
      expect(names).toContain(name);
    });
  }
});

// ---------------------------------------------------------------------------
// Section 9 — Description quality (agents must understand from description alone)
// ---------------------------------------------------------------------------

describe('section 9 — tool descriptions', () => {
  it('every tool has description longer than 20 characters', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('mastishk_inject description mentions context or task', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_inject')!;
    const desc = t.description.toLowerCase();
    expect(desc.includes('context') || desc.includes('task') || desc.includes('memory')).toBe(true);
  });

  it('mastishk_update description mentions update or create or memory', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_update')!;
    const desc = t.description.toLowerCase();
    expect(
      desc.includes('update') || desc.includes('create') || desc.includes('memory') || desc.includes('node')
    ).toBe(true);
  });

  it('mastishk_log description mentions issue or error or log', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_log')!;
    const desc = t.description.toLowerCase();
    expect(desc.includes('issue') || desc.includes('error') || desc.includes('log')).toBe(true);
  });

  it('mastishk_status description mentions status or health or summary', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_status')!;
    const desc = t.description.toLowerCase();
    expect(desc.includes('status') || desc.includes('health') || desc.includes('summary')).toBe(true);
  });

  it('mastishk_checkpoint description mentions git or commit or checkpoint', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_checkpoint')!;
    const desc = t.description.toLowerCase();
    expect(desc.includes('git') || desc.includes('commit') || desc.includes('checkpoint')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 9 — Required parameters
// ---------------------------------------------------------------------------

describe('section 9 — required parameters', () => {
  it('mastishk_inject requires: task', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_inject')!;
    expect(t.inputSchema.required).toContain('task');
  });

  it('mastishk_update requires: id, content, layer', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_update')!;
    expect(t.inputSchema.required).toContain('id');
    expect(t.inputSchema.required).toContain('content');
    expect(t.inputSchema.required).toContain('layer');
  });

  it('mastishk_log requires: message', () => {
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
// Section 9 — Tool handler functionality
// ---------------------------------------------------------------------------

describe('section 9 — toolInject handler', () => {
  it('returns string starting with ## Mastishk context', async () => {
    const result = await toolInject({ task: 'ship npm' }, ctx);
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^## Mastishk context/);
  });

  it('returns header even with empty memory', async () => {
    const result = await toolInject({ task: 'no matches here xyzzy' }, ctx);
    expect(result).toMatch(/^## Mastishk context/);
  });
});

describe('section 9 — toolUpdate handler', () => {
  it('creates new node when id does not exist, returns string containing "Created"', async () => {
    const result = await toolUpdate({ id: 'goal-new', content: 'New goal.', layer: 'intent' }, ctx);
    expect(typeof result).toBe('string');
    expect(result).toContain('Created');
    expect(result).toContain('goal-new');
  });

  it('returns "Updated" for existing node', async () => {
    await toolUpdate({ id: 'goal-existing', content: 'First.', layer: 'intent' }, ctx);
    const result = await toolUpdate({ id: 'goal-existing', content: 'Updated.', layer: 'intent' }, ctx);
    expect(result).toContain('Updated');
  });

  it('agent-created nodes have confidence 0.7', async () => {
    await toolUpdate({ id: 'goal-conf-check', content: 'Body.', layer: 'intent' }, ctx);
    const { readNode } = await import('@mastishk/core');
    const node = await readNode(join(ctx.mastishkDir, 'intent', 'goal-conf-check.msk.md'));
    expect(node.confidence).toBe(0.7);
  });

  it('infers type=task for state layer', async () => {
    await toolUpdate({ id: 'task-state', content: 'State task.', layer: 'state' }, ctx);
    const { readNode } = await import('@mastishk/core');
    const node = await readNode(join(ctx.mastishkDir, 'state', 'task-state.msk.md'));
    expect(node.type).toBe('task');
  });

  it('infers type=issue for issues layer', async () => {
    await toolUpdate({ id: 'issue-test', content: 'Issue body.', layer: 'issues' }, ctx);
    const { readNode } = await import('@mastishk/core');
    const node = await readNode(join(ctx.mastishkDir, 'issues', 'issue-test.msk.md'));
    expect(node.type).toBe('issue');
  });

  it('infers type=fact for knowledge layer', async () => {
    await toolUpdate({ id: 'fact-stack', content: 'TypeScript.', layer: 'knowledge' }, ctx);
    const { readNode } = await import('@mastishk/core');
    const node = await readNode(join(ctx.mastishkDir, 'knowledge', 'fact-stack.msk.md'));
    expect(node.type).toBe('fact');
  });
});

describe('section 9 — toolLog handler', () => {
  it('returns string containing issue id and message', async () => {
    const result = await toolLog({ message: 'Zod version conflict.' }, ctx);
    expect(typeof result).toBe('string');
    expect(result).toContain('issue-');
    expect(result).toContain('Zod version conflict.');
  });

  it('issue node has type: issue and layer: issues', async () => {
    const result = await toolLog({ message: 'Build failed.' }, ctx);
    const id = result.match(/issue-\d+/)?.[0] ?? '';
    const { readNode } = await import('@mastishk/core');
    const node = await readNode(join(ctx.mastishkDir, `issues/${id}.msk.md`));
    expect(node.type).toBe('issue');
    expect(node.layer).toBe('issues');
  });

  it('optional type param added as tag', async () => {
    const result = await toolLog({ message: 'Critical.', type: 'error' }, ctx);
    const id = result.match(/issue-\d+/)?.[0] ?? '';
    const { readNode } = await import('@mastishk/core');
    const node = await readNode(join(ctx.mastishkDir, `issues/${id}.msk.md`));
    expect(node.tags).toContain('error');
  });
});

describe('section 9 — toolStatus handler', () => {
  it('returns string with total node count', async () => {
    const result = await toolStatus({} as Record<string, never>, ctx);
    expect(typeof result).toBe('string');
    expect(result).toContain('Total nodes:');
  });

  it('returns "Open issues: none" when no issues', async () => {
    const result = await toolStatus({} as Record<string, never>, ctx);
    expect(result).toContain('Open issues: none');
  });

  it('lists open issue ids when issues exist', async () => {
    const logResult = await toolLog({ message: 'Test issue.' }, ctx);
    const id = logResult.match(/issue-\d+/)?.[0] ?? '';
    const statusResult = await toolStatus({} as Record<string, never>, ctx);
    expect(statusResult).toContain(id);
  });
});

describe('section 9 — toolCheckpoint handler', () => {
  it('throws "Git checkpoint failed" on non-git directory', async () => {
    await expect(toolCheckpoint({}, ctx)).rejects.toThrow('Git checkpoint failed');
  });
});
