import { join } from 'node:path';
import { readNode } from './read.js';
import { updateNodeMeta } from './write.js';
import { readMemoryMap, writeMemoryMap, upsertNode } from './graph.js';
import type { MskNode } from './schema.js';

// Spec section 4.4 — the map/ store answers "which file does what" so agents do
// not re-explore the repository every session.
//
// The staleness contract is the load-bearing part: when ambient capture observes
// a commit touching a path a map node covers, that node MUST be flagged stale,
// and stale entries MUST be visibly marked wherever they surface. A stale map
// entry is worse than no entry — it is confidently wrong.

export interface MapEntry {
  id: string;
  path: string;
  stale: boolean;
  file: string;
  confidence: number;
  body: string;
}

function mapPath(mastishkDir: string): string {
  return join(mastishkDir, 'memory-map.json');
}

/** All map-layer nodes, newest-path-first is not meaningful — sorted by path for stable output. */
export async function readMapEntries(mastishkDir: string): Promise<MapEntry[]> {
  const map = await readMemoryMap(mapPath(mastishkDir));
  const entries: MapEntry[] = [];

  for (const [id, entry] of Object.entries(map.nodes)) {
    if (entry.layer !== 'map') continue;
    let body = '';
    let path = entry.path ?? '';
    let stale = entry.stale === true;
    try {
      const node = await readNode(join(mastishkDir, entry.file));
      body = node.body;
      // The node file is the source of truth; the index is a cache of it.
      path = node.path ?? path;
      stale = node.stale === true;
    } catch {
      // Unreadable node files are reported by doctor (spec 11), not here.
    }
    entries.push({
      id,
      path,
      stale,
      file: entry.file,
      confidence: entry.confidence,
      body,
    });
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

// A commit touching `src/auth/token.ts` must stale a map node covering that file
// and also one covering the directory `src/auth`. Directory coverage is matched
// on a path-segment boundary so `src/auth` never matches `src/authz/x.ts`.
export function pathIsCovered(nodePath: string, changedPath: string): boolean {
  const node = nodePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const changed = changedPath.replace(/\\/g, '/');
  if (node.length === 0) return false;
  return changed === node || changed.startsWith(`${node}/`);
}

export interface StaleResult {
  /** IDs of map nodes newly flagged stale by this call. */
  flagged: string[];
}

/**
 * Spec section 4.4 + 16.1 step 4 — flag every map node whose path is touched by
 * one of `changedPaths`. Already-stale nodes are left alone (no redundant writes).
 */
export async function markStaleByPaths(
  mastishkDir: string,
  changedPaths: string[],
  agent = 'git-hook'
): Promise<StaleResult> {
  if (changedPaths.length === 0) return { flagged: [] };

  const mmPath = mapPath(mastishkDir);
  let map = await readMemoryMap(mmPath);
  const flagged: string[] = [];

  for (const [id, entry] of Object.entries(map.nodes)) {
    if (entry.layer !== 'map') continue;

    // Prefer the node file's path, falling back to the index for older folders
    // written before path was cached.
    let nodePath = entry.path;
    let alreadyStale = entry.stale === true;
    if (nodePath === undefined || entry.stale === undefined) {
      try {
        const node = await readNode(join(mastishkDir, entry.file));
        nodePath = node.path ?? nodePath;
        alreadyStale = node.stale === true;
      } catch {
        continue;
      }
    }
    if (!nodePath || alreadyStale) continue;
    if (!changedPaths.some((changed) => pathIsCovered(nodePath, changed))) continue;

    await updateNodeMeta(join(mastishkDir, entry.file), {
      stale: true,
      last_updated_by: agent,
    });
    map = upsertNode(map, id, { ...entry, stale: true, path: nodePath });
    flagged.push(id);
  }

  if (flagged.length > 0) await writeMemoryMap(mmPath, map, { agent });
  return { flagged };
}

/**
 * Spec section 4.4 — an agent that has verified a stale entry clears the flag.
 * Returns false when the id is not a map node.
 */
export async function refreshMapNode(
  mastishkDir: string,
  id: string,
  agent = 'mastishk-cli'
): Promise<boolean> {
  const mmPath = mapPath(mastishkDir);
  const map = await readMemoryMap(mmPath);
  const entry = map.nodes[id];
  if (!entry || entry.layer !== 'map') return false;

  await updateNodeMeta(join(mastishkDir, entry.file), {
    stale: false,
    verified: true,
    last_updated_by: agent,
  });
  await writeMemoryMap(mmPath, upsertNode(map, id, { ...entry, stale: false }), { agent });
  return true;
}

/** Build a map node for `path`. Used by scan (spec 11) and by agents refining the map. */
export function makeMapNode(
  id: string,
  path: string,
  body: string,
  overrides: Partial<MskNode> = {}
): MskNode {
  const now = new Date().toISOString();
  return {
    id,
    type: 'file',
    layer: 'map',
    status: 'active',
    confidence: 0.6,
    created_by: 'mastishk-scan',
    created_at: now,
    last_updated_by: 'mastishk-scan',
    last_updated_at: now,
    dependencies: [],
    contradictions: [],
    tags: ['map', 'scanned'],
    scanned: true,
    path,
    stale: false,
    body,
    ...overrides,
  };
}
