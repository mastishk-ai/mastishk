import { join } from 'node:path';
import { writeNode, updateNodeMeta } from './write.js';
import { readMemoryMap, writeMemoryMap, upsertNode, nodeToMapEntry } from './graph.js';
import { readAgentsConfig, writeAgentsConfig } from './agents.js';
import { referee } from './referee.js';
import { enforceTrust } from './trust.js';
import type { MskNode } from './schema.js';
import type { MemoryMap } from './graph.js';

// Spec sections 8 + 17 — the canonical write path. Every agent write SHOULD go
// through commitNode: trust enforcement → Referee → atomic node write → index update.
// Direct writeNode/writeMemoryMap calls remain available for human tooling and tests.

export interface CommitResult {
  committed: boolean;
  /** Why the write did not land, when committed is false. */
  rejected?: 'conflict' | 'trust';
  reason?: string;
  /** IDs of nodes the write conflicted with (Referee). */
  conflictsWith?: string[];
  /** ID of the conflict node written to issues/ (strategy: flag). */
  conflictNodeId?: string;
  /** IDs of nodes marked deprecated (strategy: latest). */
  deprecated?: string[];
  /** The node as actually written (after trust enforcement), when committed. */
  node?: MskNode;
}

function nodeFile(node: MskNode): string {
  return `${node.layer}/${node.id}.msk.md`;
}

export async function commitNode(mastishkDir: string, node: MskNode): Promise<CommitResult> {
  const mapPath = join(mastishkDir, 'memory-map.json');
  const agentsConfig = await readAgentsConfig(mastishkDir);

  // 1. Trust enforcement (spec 17.3) — may cap confidence or draft-gate the node
  const trust = enforceTrust(agentsConfig, node);
  if (trust.updatedConfig) {
    await writeAgentsConfig(mastishkDir, trust.updatedConfig);
  }
  if (!trust.allowed) {
    return { committed: false, rejected: 'trust', reason: trust.reason };
  }
  const enforced = trust.node;

  // 2. Referee (spec 8.3)
  const map: MemoryMap = await readMemoryMap(mapPath);
  const strategy = agentsConfig?.conflict_strategy ?? 'flag';
  const decision = referee(map, enforced, strategy);

  if (decision.outcome === 'reject') {
    let conflictNodeId: string | undefined;
    if (decision.conflictNode) {
      const conflict = decision.conflictNode;
      await writeNode(join(mastishkDir, nodeFile(conflict)), conflict);
      await writeMemoryMap(
        mapPath,
        upsertNode(map, conflict.id, nodeToMapEntry(conflict, nodeFile(conflict))),
        { agent: enforced.last_updated_by }
      );
      conflictNodeId = conflict.id;
    }
    return {
      committed: false,
      rejected: 'conflict',
      reason: `write contradicts: ${decision.conflictsWith.join(', ')}`,
      conflictsWith: decision.conflictsWith,
      conflictNodeId,
    };
  }

  // 3. strategy 'latest' — deprecate the contradicted nodes (spec 8.3)
  let nextMap = map;
  const deprecated: string[] = [];
  if (decision.outcome === 'accept-deprecate') {
    for (const id of decision.conflictsWith) {
      const entry = nextMap.nodes[id];
      if (!entry) continue;
      await updateNodeMeta(join(mastishkDir, entry.file), {
        status: 'deprecated',
        last_updated_by: enforced.last_updated_by,
      });
      nextMap = upsertNode(nextMap, id, { ...entry, status: 'deprecated' });
      deprecated.push(id);
    }
  }

  // 4. Atomic node write + index update (spec 17.1/17.2)
  await writeNode(join(mastishkDir, nodeFile(enforced)), enforced);
  await writeMemoryMap(
    mapPath,
    upsertNode(nextMap, enforced.id, nodeToMapEntry(enforced, nodeFile(enforced))),
    { agent: enforced.last_updated_by }
  );

  return {
    committed: true,
    node: enforced,
    ...(deprecated.length > 0 ? { deprecated } : {}),
  };
}
