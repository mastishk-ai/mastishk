import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readMapEntries,
  markStaleByPaths,
  refreshMapNode,
  makeMapNode,
  pathIsCovered,
  commitNode,
  readNode,
  readMemoryMap,
  writeMemoryMap,
  createEmptyMemoryMap,
  writeAgentsConfig,
  createDefaultAgentsConfig,
} from '@mastishk/core';

let tmpDir: string;
let mastishkDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-map-'));
  mastishkDir = join(tmpDir, '.mastishk');
  await writeMemoryMap(join(mastishkDir, 'memory-map.json'), createEmptyMemoryMap());
  await writeAgentsConfig(mastishkDir, createDefaultAgentsConfig());
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function addMapNode(id: string, path: string, body = 'Does a thing.') {
  const node = makeMapNode(id, path, body, { created_by: 'mastishk-cli', last_updated_by: 'mastishk-cli' });
  const result = await commitNode(mastishkDir, node);
  expect(result.committed).toBe(true);
  return result;
}

describe('pathIsCovered — spec section 4.4', () => {
  it('matches an exact file path', () => {
    expect(pathIsCovered('src/auth/token.ts', 'src/auth/token.ts')).toBe(true);
  });

  it('matches a file inside a mapped directory', () => {
    expect(pathIsCovered('src/auth', 'src/auth/token.ts')).toBe(true);
  });

  it('does not match a sibling directory sharing a prefix', () => {
    // src/auth must not claim src/authz — the bug that makes a map lie
    expect(pathIsCovered('src/auth', 'src/authz/policy.ts')).toBe(false);
  });

  it('does not match a partial filename prefix', () => {
    expect(pathIsCovered('src/auth/token.ts', 'src/auth/token.test.ts')).toBe(false);
  });

  it('normalises windows separators in the changed path', () => {
    expect(pathIsCovered('src/auth', 'src\\auth\\token.ts')).toBe(true);
  });

  it('tolerates a trailing slash on the node path', () => {
    expect(pathIsCovered('src/auth/', 'src/auth/token.ts')).toBe(true);
  });

  it('never matches an empty node path', () => {
    expect(pathIsCovered('', 'src/auth/token.ts')).toBe(false);
  });
});

describe('makeMapNode', () => {
  it('produces a valid map/file node with path and scanned confidence', () => {
    const node = makeMapNode('map-auth', 'src/auth/token.ts', 'Signs and verifies JWTs.');
    expect(node.layer).toBe('map');
    expect(node.type).toBe('file');
    expect(node.path).toBe('src/auth/token.ts');
    expect(node.confidence).toBe(0.6);
    expect(node.scanned).toBe(true);
    expect(node.stale).toBe(false);
  });
});

describe('readMapEntries', () => {
  it('returns nothing when no map nodes exist', async () => {
    expect(await readMapEntries(mastishkDir)).toEqual([]);
  });

  it('returns map nodes sorted by path', async () => {
    await addMapNode('map-zeta', 'src/zeta.ts');
    await addMapNode('map-alpha', 'src/alpha.ts');
    const entries = await readMapEntries(mastishkDir);
    expect(entries.map((e) => e.path)).toEqual(['src/alpha.ts', 'src/zeta.ts']);
  });

  it('excludes non-map nodes', async () => {
    await addMapNode('map-alpha', 'src/alpha.ts');
    await commitNode(mastishkDir, {
      id: 'fact-stack', type: 'fact', layer: 'knowledge', status: 'active',
      confidence: 1, created_by: 'human', created_at: new Date().toISOString(),
      last_updated_by: 'human', last_updated_at: new Date().toISOString(),
      dependencies: [], contradictions: [], body: 'TypeScript.',
    });
    const entries = await readMapEntries(mastishkDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe('map-alpha');
  });
});

describe('markStaleByPaths — spec sections 4.4 + 16.1 step 4', () => {
  it('flags a map node whose exact path changed', async () => {
    await addMapNode('map-auth', 'src/auth/token.ts');
    const { flagged } = await markStaleByPaths(mastishkDir, ['src/auth/token.ts']);
    expect(flagged).toEqual(['map-auth']);

    const node = await readNode(join(mastishkDir, 'map', 'map-auth.msk.md'));
    expect(node.stale).toBe(true);
  });

  it('flags a directory map node when a file inside it changed', async () => {
    await addMapNode('map-auth-dir', 'src/auth');
    const { flagged } = await markStaleByPaths(mastishkDir, ['src/auth/token.ts']);
    expect(flagged).toEqual(['map-auth-dir']);
  });

  it('leaves untouched paths alone', async () => {
    await addMapNode('map-auth', 'src/auth/token.ts');
    await addMapNode('map-db', 'src/db/client.ts');
    const { flagged } = await markStaleByPaths(mastishkDir, ['src/db/client.ts']);
    expect(flagged).toEqual(['map-db']);

    const untouched = await readNode(join(mastishkDir, 'map', 'map-auth.msk.md'));
    expect(untouched.stale).toBe(false);
  });

  it('mirrors the stale flag into memory-map.json', async () => {
    await addMapNode('map-auth', 'src/auth/token.ts');
    await markStaleByPaths(mastishkDir, ['src/auth/token.ts']);
    const map = await readMemoryMap(join(mastishkDir, 'memory-map.json'));
    expect(map.nodes['map-auth']!.stale).toBe(true);
  });

  it('does not re-flag an already-stale node', async () => {
    await addMapNode('map-auth', 'src/auth/token.ts');
    await markStaleByPaths(mastishkDir, ['src/auth/token.ts']);
    const second = await markStaleByPaths(mastishkDir, ['src/auth/token.ts']);
    expect(second.flagged).toEqual([]);
  });

  it('is a no-op for an empty changed-path list', async () => {
    await addMapNode('map-auth', 'src/auth/token.ts');
    expect((await markStaleByPaths(mastishkDir, [])).flagged).toEqual([]);
  });

  it('ignores non-map layers even when their ids look pathlike', async () => {
    await commitNode(mastishkDir, {
      id: 'task-src-auth', type: 'task', layer: 'state', status: 'active',
      confidence: 1, created_by: 'human', created_at: new Date().toISOString(),
      last_updated_by: 'human', last_updated_at: new Date().toISOString(),
      dependencies: [], contradictions: [], body: 'Work on src/auth.',
    });
    expect((await markStaleByPaths(mastishkDir, ['src/auth/token.ts'])).flagged).toEqual([]);
  });
});

describe('refreshMapNode — spec section 4.4', () => {
  it('clears the stale flag and marks the node verified', async () => {
    await addMapNode('map-auth', 'src/auth/token.ts');
    await markStaleByPaths(mastishkDir, ['src/auth/token.ts']);

    expect(await refreshMapNode(mastishkDir, 'map-auth')).toBe(true);

    const node = await readNode(join(mastishkDir, 'map', 'map-auth.msk.md'));
    expect(node.stale).toBe(false);
    expect(node.verified).toBe(true);
  });

  it('clears the flag in memory-map.json too', async () => {
    await addMapNode('map-auth', 'src/auth/token.ts');
    await markStaleByPaths(mastishkDir, ['src/auth/token.ts']);
    await refreshMapNode(mastishkDir, 'map-auth');
    const map = await readMemoryMap(join(mastishkDir, 'memory-map.json'));
    expect(map.nodes['map-auth']!.stale).toBe(false);
  });

  it('returns false for an unknown id', async () => {
    expect(await refreshMapNode(mastishkDir, 'map-nope')).toBe(false);
  });

  it('returns false for a node that is not in the map layer', async () => {
    await commitNode(mastishkDir, {
      id: 'fact-stack', type: 'fact', layer: 'knowledge', status: 'active',
      confidence: 1, created_by: 'human', created_at: new Date().toISOString(),
      last_updated_by: 'human', last_updated_at: new Date().toISOString(),
      dependencies: [], contradictions: [], body: 'TypeScript.',
    });
    expect(await refreshMapNode(mastishkDir, 'fact-stack')).toBe(false);
  });
});
