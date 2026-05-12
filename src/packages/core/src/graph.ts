import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MskLayer, MskType, MskStatus } from './schema.js';

// Spec section 5.1 — memory-map.json structure

export interface MemoryMapNode {
  file: string;
  layer: MskLayer;
  type: MskType;
  status: MskStatus;
  confidence: number;
  dependencies: string[];
  tags?: string[];
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

export async function writeMemoryMap(filePath: string, map: MemoryMap): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const updated: MemoryMap = { ...map, updated_at: new Date().toISOString() };
  await writeFile(filePath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
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
