import type { MemoryMap, MemoryMapNode } from './graph.js';

// Spec section 5.3 — traversal parameters
export interface TraverseOptions {
  depth?: number;          // max hops from seed — default 2
  statusFilter?: string[]; // only include these statuses — default ['active']
  minConfidence?: number;  // exclude nodes below this — default 0.5
}

export interface TraversalResult {
  id: string;
  node: MemoryMapNode;
  depth: number;
}

// Spec section 5.3 — traverse the DAG from seedIds following dependency edges outward.
export function traverse(
  map: MemoryMap,
  seedIds: string[],
  options: TraverseOptions = {}
): TraversalResult[] {
  const {
    depth = 2,
    statusFilter = ['active'],
    minConfidence = 0.5,
  } = options;

  const visited = new Set<string>();
  const results: TraversalResult[] = [];

  function visit(id: string, currentDepth: number): void {
    if (visited.has(id)) return;
    if (currentDepth > depth) return;

    const node = map.nodes[id];
    if (!node) return;
    if (!statusFilter.includes(node.status)) return;
    if (node.confidence < minConfidence) return;

    visited.add(id);
    results.push({ id, node, depth: currentDepth });

    for (const depId of node.dependencies) {
      visit(depId, currentDepth + 1);
    }
  }

  for (const seedId of seedIds) {
    visit(seedId, 0);
  }

  return results;
}
