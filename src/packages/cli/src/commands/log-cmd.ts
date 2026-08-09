import { join } from 'node:path';
import {
  writeNode,
  readMemoryMap,
  writeMemoryMap,
  upsertNode,
  nodeToMapEntry,
} from '@mastishk/core';
import type { MskNode } from '@mastishk/core';
import { mastishkDir, memoryMapPath, assertMastishkExists } from '../utils.js';

export interface LogOptions {
  cwd?: string;
  error?: boolean;
}

export async function logCommand(message: string, options: LogOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  await assertMastishkExists(cwd);

  const id = `issue-${Date.now()}`;
  const now = new Date().toISOString();
  const tags: string[] = options.error ? ['error'] : [];

  const node: MskNode = {
    id,
    type: 'issue',
    layer: 'issues',
    status: 'active',
    confidence: 1.0,
    created_by: 'mastishk-cli',
    created_at: now,
    last_updated_by: 'mastishk-cli',
    last_updated_at: now,
    dependencies: [],
    contradictions: [],
    tags: tags.length > 0 ? tags : undefined,
    body: message,
  };

  const relativeFile = `issues/${id}.msk.md`;
  const filePath = join(mastishkDir(cwd), relativeFile);
  await writeNode(filePath, node);

  // Update memory-map.json
  const map = await readMemoryMap(memoryMapPath(cwd));
  await writeMemoryMap(memoryMapPath(cwd), upsertNode(map, id, nodeToMapEntry(node, relativeFile)));

  console.log(`Logged issue "${id}".`);
  return id;
}
