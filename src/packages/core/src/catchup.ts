import { join } from 'node:path';
import { readMemoryMap } from './graph.js';
import { readNode } from './read.js';
import { readAgentsConfig } from './agents.js';
import type { MskNode } from './schema.js';

// Spec section 15.4 — catchup: what changed in shared memory since this agent's
// last session. Output order is protocol-defined:
//   1. most recent active handoff (full body)
//   2. tasks resolved since last session
//   3. new or updated issues
//   4. knowledge nodes added or changed
//   5. map nodes flagged stale
//   6. next unblocked plan step
// The output SHOULD fit in 2,000 characters; it is the first thing an agent reads.
//
// SPEC-GAP: section 15.4 says the diff is "computed from the git history of
// .mastishk/ and node timestamps". This implementation uses node timestamps only.
// Timestamps alone answer every ordered section above, and staying git-free keeps
// catchup working in a memory folder that was never committed. Git history would
// add: nodes deleted since the last session, and per-commit attribution for
// changes an agent made without touching last_updated_at. Revisit if either
// becomes load-bearing.

const MAX_ITEMS_PER_SECTION = 5;
const CHAR_LIMIT = 2000;

function firstSentence(text: string): string {
  const match = text.match(/^[^.!?\n]+[.!?]?/m);
  return (match?.[0] ?? text).trim();
}

async function readAllNodes(
  mastishkDir: string
): Promise<Record<string, MskNode>> {
  const map = await readMemoryMap(join(mastishkDir, 'memory-map.json'));
  const nodes: Record<string, MskNode> = {};
  await Promise.all(
    Object.entries(map.nodes).map(async ([id, entry]) => {
      try {
        nodes[id] = await readNode(join(mastishkDir, entry.file));
      } catch {
        // unreadable node files are skipped — doctor reports them (spec 11)
      }
    })
  );
  return nodes;
}

// Spec section 4.2 — a task is unblocked when every *task* dependency is resolved.
// Dependencies of other types (goals, constraints) express purpose, not ordering.
export function findNextPlanStep(nodes: Record<string, MskNode>): string | null {
  const plans = Object.values(nodes)
    .filter((n) => n.type === 'plan' && n.status === 'active')
    .sort((a, b) => Date.parse(b.last_updated_at) - Date.parse(a.last_updated_at));
  const plan = plans[0];
  if (!plan) return null;

  for (const stepId of plan.steps ?? []) {
    const step = nodes[stepId];
    if (!step || step.status !== 'active') continue;
    const blocked = step.dependencies.some((depId) => {
      const dep = nodes[depId];
      return dep !== undefined && dep.type === 'task' && dep.status !== 'resolved';
    });
    if (!blocked) return stepId;
  }
  return null;
}

function changedSince(node: MskNode, sinceMs: number): boolean {
  return Date.parse(node.last_updated_at) > sinceMs;
}

export async function catchup(mastishkDir: string, agent: string): Promise<string> {
  const config = await readAgentsConfig(mastishkDir);
  const since =
    config?.registered_agents.find((a) => a.id === agent)?.last_session_at ?? null;
  const sinceMs = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;

  const nodes = await readAllNodes(mastishkDir);
  const all = Object.values(nodes);

  const lines: string[] = [
    `## Mastishk catchup — ${agent}`,
    `Since: ${since ?? 'the beginning of memory'}`,
    '',
  ];
  let hasContent = false;

  // 1. Most recent active handoff — full body
  const handoff = all
    .filter((n) => n.type === 'handoff' && n.status === 'active')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (handoff) {
    lines.push(`### Handoff (${handoff.created_by}, ${handoff.created_at})`, handoff.body, '');
    hasContent = true;
  }

  function section(title: string, items: MskNode[], render: (n: MskNode) => string): void {
    if (items.length === 0) return;
    hasContent = true;
    lines.push(`### ${title}`);
    for (const n of items.slice(0, MAX_ITEMS_PER_SECTION)) lines.push(render(n));
    if (items.length > MAX_ITEMS_PER_SECTION) {
      lines.push(`…and ${items.length - MAX_ITEMS_PER_SECTION} more`);
    }
    lines.push('');
  }

  // 2. Tasks resolved since last session
  section(
    'Resolved since your last session',
    all.filter((n) => n.type === 'task' && n.status === 'resolved' && changedSince(n, sinceMs)),
    (n) => `- ${n.id}`
  );

  // 3. New or updated issues
  section(
    'Issues (new or updated)',
    all.filter((n) => n.layer === 'issues' && changedSince(n, sinceMs)),
    (n) => `- ${n.id} [${n.status}] — ${firstSentence(n.body)}`
  );

  // 4. Knowledge added or changed
  section(
    'Knowledge (added or changed)',
    all.filter((n) => n.layer === 'knowledge' && changedSince(n, sinceMs)),
    (n) => `- ${n.id} — ${firstSentence(n.body)}`
  );

  // 5. Map nodes flagged stale
  section(
    'Codebase map entries gone stale',
    all.filter((n) => n.layer === 'map' && n.stale === true),
    (n) => `- ${n.id} (${n.path ?? '?'}) — verify before relying on it`
  );

  // 6. Next unblocked plan step
  const next = findNextPlanStep(nodes);
  if (next) {
    lines.push(`### Next unblocked plan step`, `- ${next}`, '');
    hasContent = true;
  }

  if (!hasContent) {
    lines.push('Nothing new since your last session.');
  }

  const output = lines.join('\n').trimEnd();
  // Spec 15.4: SHOULD fit in 2,000 characters — hard-truncate as a last resort.
  return output.length <= CHAR_LIMIT ? output : `${output.slice(0, CHAR_LIMIT - 2)}…`;
}
