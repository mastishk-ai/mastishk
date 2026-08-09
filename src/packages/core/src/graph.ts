import { readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeFileAtomic } from './atomic.js';
import { acquireLock } from './lock.js';
import type { MskLayer, MskType, MskStatus, MskNode } from './schema.js';

// Spec section 5.1 — memory-map.json structure

export interface MemoryMapNode {
  file: string;
  layer: MskLayer;
  type: MskType;
  status: MskStatus;
  confidence: number;
  dependencies: string[];
  tags?: string[];
  // v0.3 — indexed so the Referee (spec 8.3) can check declared conflicts in
  // both directions without reading every node file.
  contradictions?: string[];
  // v0.3 — cached salient body terms so inject seeding (spec 6.2) can match
  // body content without reading every node file.
  keywords?: string[];
  // v0.3 — the repo-relative path a map node describes (spec 4.4). Indexed so
  // ambient capture (spec 16.1) can match a commit's changed paths against map
  // nodes without opening every node file on every commit.
  path?: string;
  // v0.3 — staleness flag mirrored from the node (spec 4.4), so `map --stale`
  // and doctor can report without a full filesystem sweep.
  stale?: boolean;
}

export interface MemoryMapEdge {
  from: string;
  to: string;
  relation: string;
}

export interface MemoryMap {
  version: string;
  updated_at: string;
  nodes: Record<string, MemoryMapNode>;
  edges: MemoryMapEdge[];
}

// Spec section 5.2 — typed error for DAG constraint violations
export class MskGraphError extends Error {
  readonly violation: 'cycle' | 'dangling' | 'duplicate';

  constructor(message: string, violation: 'cycle' | 'dangling' | 'duplicate') {
    super(message);
    this.name = 'MskGraphError';
    this.violation = violation;
  }
}

export function createEmptyMemoryMap(): MemoryMap {
  return {
    version: '0.1',
    updated_at: new Date().toISOString(),
    nodes: {},
    edges: [],
  };
}

export async function readMemoryMap(filePath: string): Promise<MemoryMap> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (cause) {
    throw new Error(`Cannot read memory-map.json at "${filePath}"`, { cause });
  }
  return JSON.parse(raw) as MemoryMap;
}

// Spec section 17 — memory-map.json updates are atomic and guarded by .mastishk/.lock
export async function writeMemoryMap(
  filePath: string,
  map: MemoryMap,
  options: { agent?: string } = {}
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const release = await acquireLock(dirname(filePath), options.agent ?? 'unknown');
  try {
    const updated: MemoryMap = { ...map, updated_at: new Date().toISOString() };
    await writeFileAtomic(filePath, JSON.stringify(updated, null, 2) + '\n');
  } finally {
    await release();
  }
}

// Spec section 5.1 — keywords cache: salient terms from the node body, so seed
// matching can consider body content without filesystem reads. Deliberately
// simple; richer seeders are pluggable (spec 6.2).
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were',
  'have', 'has', 'had', 'not', 'but', 'all', 'its', 'their', 'will', 'must',
  'should', 'when', 'then', 'than', 'into', 'over', 'under', 'about', 'after',
  'before', 'every', 'never', 'always', 'been', 'being', 'they', 'them', 'these',
  'those', 'there', 'here', 'what', 'which', 'while', 'because', 'does', 'doing',
]);
const MAX_KEYWORDS = 12;

export function extractKeywords(body: string): string[] {
  const seen = new Set<string>();
  for (const word of body.toLowerCase().split(/\W+/)) {
    if (word.length < 4 || STOPWORDS.has(word)) continue;
    seen.add(word);
    if (seen.size >= MAX_KEYWORDS) break;
  }
  return [...seen];
}

// Build the memory-map.json index entry for a node (spec section 5.1).
// Single source of truth for what gets indexed — used by all write paths.
export function nodeToMapEntry(node: MskNode, file: string): MemoryMapNode {
  const keywords = extractKeywords(node.body);
  return {
    file,
    layer: node.layer,
    type: node.type,
    status: node.status,
    confidence: node.confidence,
    dependencies: node.dependencies,
    ...(node.tags !== undefined ? { tags: node.tags } : {}),
    ...(node.contradictions.length > 0 ? { contradictions: node.contradictions } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
    ...(node.path !== undefined ? { path: node.path } : {}),
    ...(node.stale !== undefined ? { stale: node.stale } : {}),
  };
}

// Spec section 5.2 — cycle detection via DFS coloring (white/gray/black)
function findCycle(nodes: Record<string, MemoryMapNode>): string | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color: Record<string, number> = {};
  for (const id of Object.keys(nodes)) color[id] = WHITE;

  function dfs(id: string, path: string[]): string | null {
    color[id] = GRAY;
    for (const dep of nodes[id]?.dependencies ?? []) {
      if (!(dep in color)) continue; // dangling — caught separately
      if (color[dep] === GRAY) return [...path, id, dep].join(' → ');
      if (color[dep] === WHITE) {
        const cycle = dfs(dep, [...path, id]);
        if (cycle) return cycle;
      }
    }
    color[id] = BLACK;
    return null;
  }

  for (const id of Object.keys(nodes)) {
    if (color[id] === WHITE) {
      const cycle = dfs(id, []);
      if (cycle) return cycle;
    }
  }
  return null;
}

// Spec section 5.2 — validates no cycles, no dangling refs, unique IDs.
// Returns { valid, errors } rather than throwing so callers can choose.
// Use assertValidGraph() to get the typed throw behaviour.
export function validateGraph(map: MemoryMap): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set(Object.keys(map.nodes));

  // No dangling references in dependencies
  for (const [id, node] of Object.entries(map.nodes)) {
    for (const dep of node.dependencies) {
      if (!ids.has(dep)) {
        errors.push(`Node "${id}" has dangling dependency: "${dep}"`);
      }
    }
  }

  // No cycles
  const cycle = findCycle(map.nodes);
  if (cycle) errors.push(`Cycle detected: ${cycle}`);

  return { valid: errors.length === 0, errors };
}

// Throws MskGraphError if any constraint is violated. Spec section 5.2.
export function assertValidGraph(map: MemoryMap): void {
  const { valid, errors } = validateGraph(map);
  if (!valid) {
    const hasCycle = errors.some((e) => e.startsWith('Cycle'));
    const hasDangling = errors.some((e) => e.includes('dangling'));
    const violation = hasCycle ? 'cycle' : hasDangling ? 'dangling' : 'duplicate';
    throw new MskGraphError(errors.join('; '), violation);
  }
}

// Rebuild edges array from dependencies — keeps edges consistent with node data.
// SPEC-GAP: spec shows edges with semantic relation types (e.g. "serves") but does
// not define how they are assigned. We use "depends-on" as the default relation.
function rebuildEdges(nodes: Record<string, MemoryMapNode>): MemoryMapEdge[] {
  const edges: MemoryMapEdge[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    for (const dep of node.dependencies) {
      edges.push({ from: id, to: dep, relation: 'depends-on' });
    }
  }
  return edges;
}

export function upsertNode(map: MemoryMap, id: string, entry: MemoryMapNode): MemoryMap {
  const nodes = { ...map.nodes, [id]: entry };
  return { ...map, nodes, edges: rebuildEdges(nodes), updated_at: new Date().toISOString() };
}

export function removeNode(map: MemoryMap, id: string): MemoryMap {
  const { [id]: _removed, ...rest } = map.nodes;
  return { ...map, nodes: rest, edges: rebuildEdges(rest), updated_at: new Date().toISOString() };
}
