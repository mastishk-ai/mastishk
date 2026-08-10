import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  inject,
  readMemoryMap,
  readNode,
  commitNode,
  sessionStart,
  sessionEnd,
  readActiveSessions,
  catchup,
} from '@mastishk/core';
import type { MskNode, MskLayer, MskType, MemoryMapNode, CommitResult } from '@mastishk/core';

const execAsync = promisify(exec);

export interface ToolContext {
  mastishkDir: string;
}

function memMapPath(ctx: ToolContext): string {
  return join(ctx.mastishkDir, 'memory-map.json');
}

// SPEC-GAP: spec defines mastishk_update params as (id, content, layer) but does not
// specify how to infer the MskType for a new node from its layer. We use this mapping.
const DEFAULT_TYPE_FOR_LAYER: Record<string, MskType> = {
  intent: 'goal',
  state: 'task',
  knowledge: 'fact',
  map: 'file',
  issues: 'issue',
};

// SPEC-GAP: MCP tool calls do not carry the identity of the underlying agent,
// so all MCP writes are attributed to this ID for spec 8.1 purposes.
const MCP_AGENT_ID = 'mastishk-mcp';

function describeRejection(result: CommitResult): string {
  if (result.rejected === 'conflict') {
    return (
      `Write rejected by the Referee: it contradicts ${result.conflictsWith?.join(', ')}.` +
      (result.conflictNodeId ? ` Conflict logged as "${result.conflictNodeId}".` : '') +
      ' Resolve the contradiction, then retry.'
    );
  }
  return `Write rejected: ${result.reason ?? 'not permitted'}.`;
}

// ---------------------------------------------------------------------------
// mastishk_inject — spec section 9
// ---------------------------------------------------------------------------
export async function toolInject(
  params: { task: string },
  ctx: ToolContext
): Promise<string> {
  return inject(params.task, ctx.mastishkDir);
}

// ---------------------------------------------------------------------------
// mastishk_update — spec section 10
// ---------------------------------------------------------------------------
export async function toolUpdate(
  params: { id: string; content: string; layer: string; path?: string },
  ctx: ToolContext
): Promise<string> {
  const { id, content, layer, path } = params;
  const map = await readMemoryMap(memMapPath(ctx));
  const existing = map.nodes[id];

  if (existing) {
    // Update path: read existing node, commit new content through the canonical
    // write path (Referee + trust, spec 8/17). Append for state, replace for others.
    const node = await readNode(join(ctx.mastishkDir, existing.file));
    const result = await commitNode(ctx.mastishkDir, {
      ...node,
      body: content,
      last_updated_by: MCP_AGENT_ID,
      // Spec 4.4 — an agent rewriting a map entry has verified it against the
      // code, so the staleness flag clears. That is the whole refresh cycle.
      ...(node.layer === 'map' ? { stale: false, verified: true } : {}),
      ...(path !== undefined ? { path } : {}),
    });
    if (!result.committed) return describeRejection(result);
    return `Updated node "${id}" in ${existing.layer} layer.`;
  }

  // Create path: build new node with defaults
  const mskLayer = layer as MskLayer;
  const mskType = DEFAULT_TYPE_FOR_LAYER[layer] ?? 'fact';
  const now = new Date().toISOString();

  // Spec 4.4 — a map node without a path cannot be staleness-tracked, so refuse
  // it here with an actionable message rather than letting schema validation
  // reject it with a less helpful one.
  if (mskLayer === 'map' && !path) {
    return 'Cannot create a map node without "path". Pass the repo-relative file or directory the entry describes.';
  }

  const node: MskNode = {
    id,
    type: mskType,
    layer: mskLayer,
    status: 'active',
    // Agent-created nodes get confidence 0.7 (spec section 3.2 guidance)
    confidence: 0.7,
    created_by: MCP_AGENT_ID,
    created_at: now,
    last_updated_by: MCP_AGENT_ID,
    last_updated_at: now,
    dependencies: [],
    contradictions: [],
    body: content,
    ...(path !== undefined ? { path } : {}),
    ...(mskLayer === 'map' ? { stale: false } : {}),
  };

  const result = await commitNode(ctx.mastishkDir, node);
  if (!result.committed) return describeRejection(result);
  return `Created node "${id}" in ${layer} layer.`;
}

// ---------------------------------------------------------------------------
// mastishk_log — spec section 9
// ---------------------------------------------------------------------------
export async function toolLog(
  // SPEC-GAP: spec says type?: string but doesn't define what values it accepts.
  // We treat it as a tag name (e.g. "error", "warning") added to the issue node.
  params: { message: string; type?: string },
  ctx: ToolContext
): Promise<string> {
  const id = `issue-${Date.now()}`;
  const now = new Date().toISOString();
  const tags = params.type ? [params.type] : undefined;

  const node: MskNode = {
    id,
    type: 'issue',
    layer: 'issues',
    status: 'active',
    confidence: 1.0,
    created_by: MCP_AGENT_ID,
    created_at: now,
    last_updated_by: MCP_AGENT_ID,
    last_updated_at: now,
    dependencies: [],
    contradictions: [],
    tags,
    body: params.message,
  };

  const result = await commitNode(ctx.mastishkDir, node);
  if (!result.committed) return describeRejection(result);
  return `Logged issue "${id}": ${params.message}`;
}

// ---------------------------------------------------------------------------
// mastishk_status — spec section 9
// ---------------------------------------------------------------------------
export async function toolStatus(
  _params: Record<string, never>,
  ctx: ToolContext
): Promise<string> {
  const map = await readMemoryMap(memMapPath(ctx));
  const nodes = Object.entries(map.nodes);
  const now = Date.now();

  const byLayer: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const openIssues: string[] = [];
  const staleNodes: string[] = [];

  for (const [id, node] of nodes) {
    byLayer[node.layer] = (byLayer[node.layer] ?? 0) + 1;
    byStatus[node.status] = (byStatus[node.status] ?? 0) + 1;
    if (node.layer === 'issues' && node.status === 'active') openIssues.push(id);
    const n = node as MemoryMapNode & { expires_at?: string };
    if (n.expires_at && new Date(n.expires_at).getTime() < now && node.status !== 'resolved') {
      staleNodes.push(id);
    }
  }

  const lines = [
    `Total nodes: ${nodes.length}`,
    `By layer: ${JSON.stringify(byLayer)}`,
    `By status: ${JSON.stringify(byStatus)}`,
    `Open issues: ${openIssues.length > 0 ? openIssues.join(', ') : 'none'}`,
    `Stale nodes: ${staleNodes.length > 0 ? staleNodes.join(', ') : 'none'}`,
    `Last updated: ${map.updated_at}`,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// mastishk_checkpoint — spec section 9
// ---------------------------------------------------------------------------
export async function toolCheckpoint(
  params: { message?: string },
  ctx: ToolContext
): Promise<string> {
  const msg = params.message ?? `mastishk checkpoint — ${new Date().toISOString()}`;
  const projectRoot = join(ctx.mastishkDir, '..');

  try {
    await execAsync(`git add "${ctx.mastishkDir}"`, { cwd: projectRoot });
    await execAsync(`git commit -m "${msg}"`, { cwd: projectRoot });
    return `Checkpoint committed: ${msg}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Git checkpoint failed: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// mastishk_session_start — spec sections 10 + 15.1
// ---------------------------------------------------------------------------
export async function toolSessionStart(
  params: { agent: string; task: string },
  ctx: ToolContext
): Promise<string> {
  const result = await sessionStart(ctx.mastishkDir, params.agent, params.task);

  const sections: string[] = [];
  if (result.presence.length > 0) {
    // Spec 15.1 step 2 — name each active agent and its task.
    sections.push(
      '## Other agents active on this project\n' +
        result.presence
          .map((s) => `- ${s.agent} since ${s.started_at} — "${s.task}"`)
          .join('\n')
    );
  }
  sections.push(result.catchup, result.context);
  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// mastishk_session_end — spec sections 10 + 15.2
// ---------------------------------------------------------------------------
export async function toolSessionEnd(
  params: { handoff: string; agent?: string },
  ctx: ToolContext
): Promise<string> {
  // MCP tool calls do not carry agent identity (see MCP_AGENT_ID). If the caller
  // does not name itself and exactly one session is active, that is unambiguously
  // the session ending; otherwise we cannot guess and say so.
  let agent = params.agent;
  if (!agent) {
    const active = await readActiveSessions(ctx.mastishkDir);
    if (active.length === 1) {
      agent = active[0]!.agent;
    } else if (active.length === 0) {
      return 'No active session to end. Call mastishk_session_start first, or pass "agent".';
    } else {
      return (
        `Multiple sessions are active (${active.map((s) => s.agent).join(', ')}). ` +
        'Pass "agent" to say which one is ending.'
      );
    }
  }

  const result = await sessionEnd(ctx.mastishkDir, agent, { handoff: params.handoff });

  const lines: string[] = [];
  if (result.handoffId) lines.push(`Handoff written: ${result.handoffId}`);
  if (result.warning) lines.push(`Warning: ${result.warning}`);

  // Spec 15.2 step 4 — checkpoint. Degrade gracefully outside a git repo:
  // failing to commit must not lose the handoff that was already written.
  try {
    await toolCheckpoint({ message: `mastishk: session end — ${agent}` }, ctx);
    lines.push('Memory checkpointed to git.');
  } catch (err) {
    lines.push(`Checkpoint skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  lines.push(`Session ended for ${agent}.`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// mastishk_catchup — spec sections 10 + 15.4
// ---------------------------------------------------------------------------
export async function toolCatchup(
  params: { agent: string },
  ctx: ToolContext
): Promise<string> {
  return catchup(ctx.mastishkDir, params.agent);
}

// ---------------------------------------------------------------------------
// Tool definitions (spec section 10 — descriptions MUST enable first-time use)
// ---------------------------------------------------------------------------
export const TOOL_DEFINITIONS = [
  {
    name: 'mastishk_inject',
    description:
      'Get structured memory context for your current task. Call this at the start of any session ' +
      'or when you need background on goals, decisions, or prior state. Pass a natural-language ' +
      'description of what you are about to do. Returns a formatted context block with relevant ' +
      'intent, state, knowledge, and open issues from this project\'s memory.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Natural-language description of the task you are about to perform.',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'mastishk_update',
    description:
      'Update or create a memory node. Use this to persist a decision, record progress on a task, ' +
      'add a technical fact, or document a goal. For state-layer nodes (tasks), content is appended ' +
      'with a timestamp — existing entries are preserved. For intent and knowledge nodes, content ' +
      'replaces the current body. If the node ID does not exist, it is created automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Kebab-case identifier for the node, e.g. "task-implement-auth" or "decision-use-postgres".',
        },
        content: {
          type: 'string',
          description: 'Markdown content to write (appended for state nodes, replaced for others).',
        },
        layer: {
          type: 'string',
          enum: ['intent', 'state', 'knowledge', 'map', 'issues'],
          description:
            'Memory layer: intent (goals/constraints), state (tasks/progress), knowledge (decisions/facts), ' +
            'map (which file does what), issues (bugs/blockers).',
        },
        path: {
          type: 'string',
          description:
            'Repo-relative file or directory path. Required when layer is "map" — it is what ties the entry to the code.',
        },
      },
      required: ['id', 'content', 'layer'],
    },
  },
  {
    name: 'mastishk_log',
    description:
      'Append an issue, error, or blocker to memory. Use this whenever you encounter a problem ' +
      'that should be tracked: build failures, unresolved questions, known bugs, or anything that ' +
      'might block progress. Each call creates a new issue node. Pass type="error" for errors.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Description of the issue, error, or blocker to log.',
        },
        type: {
          type: 'string',
          description: 'Optional tag for the log entry, e.g. "error", "warning", "question".',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'mastishk_status',
    description:
      'Return a memory health summary for this project. Shows total node count by layer, ' +
      'status distribution, all open (unresolved) issues, and any nodes whose expires_at date ' +
      'has passed. Call this to understand the current state of project memory before starting ' +
      'significant work.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'mastishk_checkpoint',
    description:
      'Commit the current state of .mastishk/ memory to git. Call this after completing a ' +
      'significant unit of work — a feature, a decision, a resolved issue — to create a ' +
      'durable snapshot of project memory. Equivalent to running "git add .mastishk/ && git commit".',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Optional commit message. Defaults to a timestamped checkpoint message.',
        },
      },
      required: [],
    },
  },
  {
    name: 'mastishk_session_start',
    description:
      'Check in to this project\'s shared memory. Call this FIRST, before any other tool and ' +
      'before you start work — it is how you discover what other agents have already done. ' +
      'Returns three things: which other agents are currently active on this project, what ' +
      'changed in memory since your last session (the previous session\'s handoff, resolved ' +
      'tasks, new issues, stale map entries), and the causal context for your task. Read all ' +
      'of it before touching any code.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Your agent ID, e.g. "claude-code" or "cursor". Used to work out what is new for you.',
        },
        task: {
          type: 'string',
          description: 'Natural-language description of what you are about to work on.',
        },
      },
      required: ['agent', 'task'],
    },
  },
  {
    name: 'mastishk_session_end',
    description:
      'Hand off to the next agent and check out. Call this when you finish working, before the ' +
      'conversation ends — an unwritten handoff means the next agent (or the next you) starts ' +
      'cold and repeats your work. Writes a handoff note to memory, records your session, and ' +
      'commits memory to git. Structure the handoff around four things: what you completed, ' +
      'what is half-finished and where, what the next session must not break, and what to pick ' +
      'up first.',
    inputSchema: {
      type: 'object',
      properties: {
        handoff: {
          type: 'string',
          description:
            'The handoff note. Cover: Done / In flight / Watch out / Next. Be specific — name files and line numbers.',
        },
        agent: {
          type: 'string',
          description: 'Your agent ID. Optional when exactly one session is active.',
        },
      },
      required: ['handoff'],
    },
  },
  {
    name: 'mastishk_catchup',
    description:
      'Summarise what changed in project memory since your last session, without starting a ' +
      'new one. Use this when you are already checked in and want to re-orient — for example ' +
      'after a long pause, or when another agent has been working in parallel. Returns, in ' +
      'order: the most recent handoff, tasks resolved since you were last here, new or updated ' +
      'issues, new knowledge, codebase map entries that have gone stale, and the next unblocked ' +
      'plan step.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Your agent ID, e.g. "claude-code". Determines the point to diff from.',
        },
      },
      required: ['agent'],
    },
  },
] as const;
