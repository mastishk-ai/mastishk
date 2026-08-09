import type { MemoryMap } from './graph.js';
import type { MskNode } from './schema.js';
import type { ConflictStrategy } from './agents.js';

// Spec section 8.3 — the Referee, deterministic core.
//
// A write is a *declared conflict* when:
//   (a) the incoming node lists an existing active node in `contradictions`, or
//   (b) an existing active node lists the incoming node's ID in its `contradictions`.
//
// On a declared conflict the configured conflict_strategy applies:
//   flag   — reject, create a conflict node in issues/, halt (default)
//   human  — reject, require human resolution before retry
//   latest — accept the write; contradicted nodes are marked deprecated
//
// Semantic (model-based) contradiction detection is an optional, pluggable
// extension (spec 8.3) and is intentionally NOT part of this module.

export interface RefereeDecision {
  /** What the caller must do with the write. */
  outcome: 'accept' | 'reject' | 'accept-deprecate';
  /** IDs of existing active nodes the incoming write conflicts with. */
  conflictsWith: string[];
  /** Present when outcome is 'reject' under strategy 'flag' — write this to issues/. */
  conflictNode?: MskNode;
}

function findDeclaredConflicts(map: MemoryMap, incoming: MskNode): string[] {
  const conflicts = new Set<string>();

  // (a) incoming declares contradictions against existing active nodes
  for (const id of incoming.contradictions) {
    const existing = map.nodes[id];
    if (existing && existing.status === 'active') conflicts.add(id);
  }

  // (b) existing active nodes declare contradictions against the incoming ID
  for (const [id, entry] of Object.entries(map.nodes)) {
    if (id === incoming.id) continue;
    if (entry.status !== 'active') continue;
    if (entry.contradictions?.includes(incoming.id)) conflicts.add(id);
  }

  return [...conflicts];
}

// Spec section 8.3 — the conflict node references the contradicting (existing)
// nodes in `dependencies`; the rejected incoming write is identified in the body
// and cannot be a dependency because it was never committed to the graph.
export function createConflictNode(
  incoming: MskNode,
  conflictsWith: string[],
  timestamp = new Date()
): MskNode {
  const iso = timestamp.toISOString();
  return {
    id: `conflict-${incoming.id}-${timestamp.getTime()}`,
    type: 'issue',
    layer: 'issues',
    status: 'active',
    confidence: 1.0,
    created_by: incoming.last_updated_by,
    created_at: iso,
    last_updated_by: incoming.last_updated_by,
    last_updated_at: iso,
    dependencies: conflictsWith,
    contradictions: [],
    tags: ['conflict', 'referee'],
    body:
      `Referee rejected a write to "${incoming.id}" by ${incoming.last_updated_by}: ` +
      `it contradicts ${conflictsWith.map((c) => `"${c}"`).join(', ')}. ` +
      `Resolve the contradiction, then retry the write.\n\n` +
      `Rejected content:\n> ${incoming.body.split('\n').join('\n> ')}`,
  };
}

export function referee(
  map: MemoryMap,
  incoming: MskNode,
  strategy: ConflictStrategy = 'flag'
): RefereeDecision {
  const conflictsWith = findDeclaredConflicts(map, incoming);
  if (conflictsWith.length === 0) {
    return { outcome: 'accept', conflictsWith: [] };
  }

  switch (strategy) {
    case 'latest':
      return { outcome: 'accept-deprecate', conflictsWith };
    case 'human':
      return { outcome: 'reject', conflictsWith };
    case 'flag':
    default:
      return {
        outcome: 'reject',
        conflictsWith,
        conflictNode: createConflictNode(incoming, conflictsWith),
      };
  }
}
