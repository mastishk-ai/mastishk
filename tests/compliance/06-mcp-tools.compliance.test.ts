/**
 * Compliance suite — Section 10: MCP tool interface
 *
 * Tests that the MCP server exposes exactly the eight required tools with:
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
  toolSessionStart,
  toolSessionEnd,
  toolCatchup,
} from '../../src/packages/mcp/src/tools.js';
import { readActiveSessions } from '@mastishk/core';
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
// Section 10 — Tool presence and names
// ---------------------------------------------------------------------------

describe('section 10 — required tool names', () => {
  const required = [
    'mastishk_inject',
    'mastishk_update',
    'mastishk_log',
    'mastishk_status',
    'mastishk_checkpoint',
    // v0.3 — the session protocol over MCP
    'mastishk_session_start',
    'mastishk_session_end',
    'mastishk_catchup',
  ];

  it('exposes exactly the eight tools in the section 10 table', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(8);
    expect(TOOL_DEFINITIONS.map((t) => t.name).sort()).toEqual([...required].sort());
  });

  for (const name of required) {
    it(`exposes tool: ${name}`, () => {
      const names = TOOL_DEFINITIONS.map((t) => t.name);
      expect(names).toContain(name);
    });
  }
});

// ---------------------------------------------------------------------------
// Section 10 — Description quality (agents must understand from description alone)
// ---------------------------------------------------------------------------

describe('section 10 — tool descriptions', () => {
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
// Section 10 — Required parameters
// ---------------------------------------------------------------------------

describe('section 10 — required parameters', () => {
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

  it('mastishk_session_start requires: agent, task', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_session_start')!;
    expect(t.inputSchema.required).toContain('agent');
    expect(t.inputSchema.required).toContain('task');
  });

  it('mastishk_session_end requires: handoff', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_session_end')!;
    expect(t.inputSchema.required).toContain('handoff');
  });

  it('mastishk_catchup requires: agent', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_catchup')!;
    expect(t.inputSchema.required).toContain('agent');
  });
});

// ---------------------------------------------------------------------------
// Section 10 + 15 — the session tools
// ---------------------------------------------------------------------------

describe('section 10 — session tool descriptions', () => {
  // Tool descriptions are protocol surface: an agent meeting them cold must
  // learn both what the tool does and when to reach for it.
  it('session_start tells the agent to call it first', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_session_start')!;
    expect(t.description.toLowerCase()).toContain('first');
  });

  it('session_end explains the cost of skipping the handoff', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_session_end')!;
    expect(t.description.toLowerCase()).toContain('handoff');
  });

  it('catchup describes what it diffs against', () => {
    const t = TOOL_DEFINITIONS.find((t) => t.name === 'mastishk_catchup')!;
    expect(t.description.toLowerCase()).toContain('last session');
  });
});

describe('section 15 — session tool handlers', () => {
  it('toolSessionStart registers presence and returns catchup plus context', async () => {
    const result = await toolSessionStart({ agent: 'claude-code', task: 'ship npm' }, ctx);
    expect(result).toContain('Mastishk catchup');
    expect(result).toContain('## Mastishk context');

    const active = await readActiveSessions(ctx.mastishkDir);
    expect(active.map((s) => s.agent)).toContain('claude-code');
  });

  it('toolSessionStart names other active agents', async () => {
    await toolSessionStart({ agent: 'cursor', task: 'refactor db' }, ctx);
    const result = await toolSessionStart({ agent: 'claude-code', task: 'ship npm' }, ctx);
    expect(result).toContain('cursor');
    expect(result).toContain('refactor db');
  });

  it('toolCatchup returns the ordered catchup summary', async () => {
    const result = await toolCatchup({ agent: 'claude-code' }, ctx);
    expect(result).toContain('Mastishk catchup');
  });

  it('toolSessionEnd writes a handoff and deregisters', async () => {
    await toolSessionStart({ agent: 'claude-code', task: 'ship npm' }, ctx);
    const result = await toolSessionEnd(
      { handoff: 'Done: packaging. Next: publish.' },
      ctx
    );
    expect(result).toContain('Handoff written');

    const active = await readActiveSessions(ctx.mastishkDir);
    expect(active.map((s) => s.agent)).not.toContain('claude-code');
  });

  it('toolSessionEnd says so plainly when there is no session to end', async () => {
    const result = await toolSessionEnd({ handoff: 'Nothing.' }, ctx);
    expect(result).toContain('No active session');
  });

  it('toolSessionEnd refuses to guess between several active sessions', async () => {
    await toolSessionStart({ agent: 'claude-code', task: 'a' }, ctx);
    await toolSessionStart({ agent: 'cursor', task: 'b' }, ctx);
    const result = await toolSessionEnd({ handoff: 'Done.' }, ctx);
    expect(result).toContain('Multiple sessions');
  });

  it('toolSessionEnd ends the named session when several are active', async () => {
    await toolSessionStart({ agent: 'claude-code', task: 'a' }, ctx);
    await toolSessionStart({ agent: 'cursor', task: 'b' }, ctx);
    await toolSessionEnd({ handoff: 'Done.', agent: 'cursor' }, ctx);

    const active = await readActiveSessions(ctx.mastishkDir);
    expect(active.map((s) => s.agent)).toEqual(['claude-code']);
  });
});

// ---------------------------------------------------------------------------
// Section 10 — Tool handler functionality
// ---------------------------------------------------------------------------

describe('section 10 — toolInject handler', () => {
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

describe('section 10 — toolUpdate handler', () => {
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

describe('section 10 — toolLog handler', () => {
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

describe('section 10 — toolStatus handler', () => {
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

describe('section 10 — toolCheckpoint handler', () => {
  it('throws "Git checkpoint failed" on non-git directory', async () => {
    await expect(toolCheckpoint({}, ctx)).rejects.toThrow('Git checkpoint failed');
  });
});
