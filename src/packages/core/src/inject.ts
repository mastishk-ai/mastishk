import { join } from 'node:path';
import { readMemoryMap } from './graph.js';
import { traverse } from './traverse.js';
import { readNode } from './read.js';
import type { TraversalResult } from './traverse.js';

const LAYER_ORDER: Record<string, number> = { intent: 0, state: 1, knowledge: 2, issues: 3 };

// SPEC-GAP: "token" is not defined by the spec (it is model-specific).
// We approximate: 1 token ≈ 4 characters.
const CHARS_PER_TOKEN = 4;
const TOKEN_BUDGET = 2000;
const CHAR_BUDGET = TOKEN_BUDGET * CHARS_PER_TOKEN;

function tokenize(str: string): string[] {
  return str.toLowerCase().split(/\W+/).filter(Boolean);
}

// Score how well a node's id and tags match the task tokens.
// SPEC-GAP: spec says match against id, tags, AND body content. Reading all node files
// for body-content matching is expensive; we match id and tags from memory-map.json only.
function matchScore(id: string, node: { tags?: string[] }, tokens: string[]): number {
  let score = 0;
  const idParts = id.split('-');
  for (const token of tokens) {
    if (idParts.includes(token)) score += 2;
    if (node.tags?.some((t) => t.toLowerCase() === token)) score += 1;
  }
  return score;
}

function firstSentence(text: string): string {
  const match = text.match(/^[^.!?]+[.!?]?/);
  return (match?.[0] ?? text).trim();
}

async function readBodySafe(mastishkDir: string, file: string): Promise<string> {
  try {
    const node = await readNode(join(mastishkDir, file));
    return node.body;
  } catch {
    return '';
  }
}

// Spec section 6.3 — render one node line
function renderNodeLine(id: string, confidence: number, body: string, fullBody: boolean): string {
  const content = fullBody ? body : firstSentence(body);
  return `**${id}** [${confidence.toFixed(1)}] — ${content}`;
}

// Spec section 6.2 — inject algorithm
export async function inject(task: string, mastishkDir: string): Promise<string> {
  const memoryMapPath = join(mastishkDir, 'memory-map.json');
  const map = await readMemoryMap(memoryMapPath);

  // Step 1-2: tokenize task, score and rank nodes by match
  const tokens = tokenize(task);
  const scored = Object.entries(map.nodes)
    .map(([id, node]) => ({ id, node, score: matchScore(id, node, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.node.confidence - a.node.confidence || b.score - a.score);

  const seedIds = scored.map((x) => x.id);

  // Step 3-4: traverse at depth 2, filter active + confidence >= 0.5
  const traversed = traverse(map, seedIds, { depth: 2, statusFilter: ['active'], minConfidence: 0.5 });

  // Step 5: sort by layer then confidence
  traversed.sort((a, b) => {
    const lo = (LAYER_ORDER[a.node.layer] ?? 99) - (LAYER_ORDER[b.node.layer] ?? 99);
    return lo !== 0 ? lo : b.node.confidence - a.node.confidence;
  });

  // Read bodies for all traversed nodes
  const bodies = await Promise.all(
    traversed.map((r) => readBodySafe(mastishkDir, r.node.file))
  );

  const nodeData = traversed.map((r, i) => ({ ...r, body: bodies[i] }));

  // Step 7: enforce 2000-token budget — drop lowest-confidence first
  const header = `## Mastishk context — ${task}\nGenerated: ${new Date().toISOString()}\n`;
  let charBudget = CHAR_BUDGET - header.length;

  // Sort a copy by confidence asc for budget truncation, but keep display order
  const budgetOrder = [...nodeData].sort((a, b) => a.node.confidence - b.node.confidence);
  const excluded = new Set<string>();

  for (const item of budgetOrder) {
    const line = renderNodeLine(item.id, item.node.confidence, item.body, item.node.confidence >= 0.9);
    if (charBudget - line.length < 0) {
      excluded.add(item.id);
    } else {
      charBudget -= line.length + 1; // +1 for newline
    }
  }

  const included = nodeData.filter((r) => !excluded.has(r.id));

  // Step 6: format output per spec section 6.3
  const byLayer: Record<string, typeof included> = {
    intent: included.filter((r) => r.node.layer === 'intent'),
    state: included.filter((r) => r.node.layer === 'state'),
    knowledge: included.filter((r) => r.node.layer === 'knowledge'),
    issues: included.filter((r) => r.node.layer === 'issues'),
  };

  function renderSection(title: string, items: typeof included): string {
    if (items.length === 0) return '';
    const lines = items
      .map((r) => renderNodeLine(r.id, r.node.confidence, r.body, r.node.confidence >= 0.9))
      .join('\n');
    return `### ${title}\n${lines}\n`;
  }

  const sections = [
    renderSection('Goals', byLayer.intent),
    renderSection('Current state', byLayer.state),
    renderSection('Knowledge', byLayer.knowledge),
    renderSection('Open issues', byLayer.issues),
  ]
    .filter(Boolean)
    .join('\n');

  return `${header}\n${sections}`.trimEnd();
}
