import { join } from 'node:path';
import { readMemoryMap } from './graph.js';
import { traverse } from './traverse.js';
import { readNode } from './read.js';
import type { MskNode } from './schema.js';

const LAYER_ORDER: Record<string, number> = { intent: 0, state: 1, knowledge: 2, map: 3, issues: 4 };

// Spec section 6.5 — the output budget is defined in characters (deterministic,
// model-independent). 8,000 chars ≈ 2,000 tokens.
const CHAR_BUDGET = 8000;

function tokenize(str: string): string[] {
  return str.toLowerCase().split(/\W+/).filter(Boolean);
}

// Spec section 6.2 — seeding matches id, tags, and body content. Body matching is
// served by the keywords cache in memory-map.json when present; falling back to
// id + tags only when a node has no cached keywords.
function matchScore(
  id: string,
  node: { tags?: string[]; keywords?: string[] },
  tokens: string[]
): number {
  let score = 0;
  const idParts = id.split('-');
  for (const token of tokens) {
    if (idParts.includes(token)) score += 2;
    if (node.tags?.some((t) => t.toLowerCase() === token)) score += 1;
    if ((node as { keywords?: string[] }).keywords?.some((k) => k.toLowerCase() === token)) score += 1;
  }
  return score;
}

function firstSentence(text: string): string {
  const match = text.match(/^[^.!?]+[.!?]?/);
  return (match?.[0] ?? text).trim();
}

interface NodeFileData {
  body: string;
  stale: boolean;
}

async function readNodeSafe(mastishkDir: string, file: string): Promise<NodeFileData> {
  try {
    const node: MskNode = await readNode(join(mastishkDir, file));
    return { body: node.body, stale: node.stale === true };
  } catch {
    return { body: '', stale: false };
  }
}

// Spec section 6.4 — render one node line; stale map entries are visibly marked.
function renderNodeLine(
  id: string,
  confidence: number,
  body: string,
  fullBody: boolean,
  stale = false
): string {
  const content = fullBody ? body : firstSentence(body);
  return `**${id}** [${confidence.toFixed(1)}]${stale ? ' (stale)' : ''} — ${content}`;
}

// Spec section 6.3 — inject algorithm
export async function inject(task: string, mastishkDir: string): Promise<string> {
  const memoryMapPath = join(mastishkDir, 'memory-map.json');
  const map = await readMemoryMap(memoryMapPath);

  // Step 1: select seeds (section 6.2), ranked by match score then confidence
  const tokens = tokenize(task);
  const scored = Object.entries(map.nodes)
    .map(([id, node]) => ({ id, node, score: matchScore(id, node, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.node.confidence - a.node.confidence);

  const seedIds = scored.map((x) => x.id);

  // Step 2-3: traverse at depth 2, filter active + confidence >= 0.5
  const traversed = traverse(map, seedIds, { depth: 2, statusFilter: ['active'], minConfidence: 0.5 });

  // Step 4: the most recent active handoff is included regardless of seed match
  // and is never dropped by the budget (spec 6.3).
  const handoffEntries = Object.entries(map.nodes)
    .filter(([, n]) => n.type === 'handoff' && n.status === 'active');
  let handoffSection = '';
  let handoffId: string | null = null;
  if (handoffEntries.length > 0) {
    // Session end resolves prior handoffs, so usually exactly one is active;
    // if several are, the one with the latest created_at wins.
    const candidates = await Promise.all(
      handoffEntries.map(async ([id, entry]) => {
        try {
          const node = await readNode(join(mastishkDir, entry.file));
          return { id, node };
        } catch {
          return null;
        }
      })
    );
    const newest = candidates
      .filter((c): c is { id: string; node: MskNode } => c !== null)
      .sort((a, b) => Date.parse(b.node.created_at) - Date.parse(a.node.created_at))[0];
    if (newest && newest.node.body) {
      handoffId = newest.id;
      handoffSection = `### Handoff from last session\n${newest.node.body}\n`;
    }
  }

  // Step 5: sort by layer then confidence; exclude the surfaced handoff
  const results = traversed.filter((r) => r.id !== handoffId);
  results.sort((a, b) => {
    const lo = (LAYER_ORDER[a.node.layer] ?? 99) - (LAYER_ORDER[b.node.layer] ?? 99);
    return lo !== 0 ? lo : b.node.confidence - a.node.confidence;
  });

  // Read bodies (and staleness) for all traversed nodes
  const fileData = await Promise.all(results.map((r) => readNodeSafe(mastishkDir, r.node.file)));
  const nodeData = results.map((r, i) => ({ ...r, body: fileData[i].body, stale: fileData[i].stale }));

  // Step 7: enforce the character budget — drop lowest-confidence nodes first.
  // The header and handoff section are reserved up front.
  const header = `## Mastishk context — ${task}\nGenerated: ${new Date().toISOString()}\n`;
  let charBudget = CHAR_BUDGET - header.length - handoffSection.length;

  const budgetOrder = [...nodeData].sort((a, b) => a.node.confidence - b.node.confidence);
  const excluded = new Set<string>();

  for (const item of budgetOrder) {
    const line = renderNodeLine(item.id, item.node.confidence, item.body, item.node.confidence >= 0.9, item.stale);
    if (charBudget - line.length < 0) {
      excluded.add(item.id);
    } else {
      charBudget -= line.length + 1; // +1 for newline
    }
  }

  const included = nodeData.filter((r) => !excluded.has(r.id));

  // Step 6: format output per spec section 6.4
  const byLayer: Record<string, typeof included> = {
    intent: included.filter((r) => r.node.layer === 'intent'),
    state: included.filter((r) => r.node.layer === 'state'),
    knowledge: included.filter((r) => r.node.layer === 'knowledge'),
    map: included.filter((r) => r.node.layer === 'map'),
    issues: included.filter((r) => r.node.layer === 'issues'),
  };

  function renderSection(title: string, items: typeof included): string {
    if (items.length === 0) return '';
    const lines = items
      .map((r) => renderNodeLine(r.id, r.node.confidence, r.body, r.node.confidence >= 0.9, r.stale))
      .join('\n');
    return `### ${title}\n${lines}\n`;
  }

  const sections = [
    handoffSection,
    renderSection('Goals', byLayer.intent),
    renderSection('Current state', byLayer.state),
    renderSection('Knowledge', byLayer.knowledge),
    renderSection('Codebase map', byLayer.map),
    renderSection('Open issues', byLayer.issues),
  ]
    .filter(Boolean)
    .join('\n');

  return `${header}\n${sections}`.trimEnd();
}
