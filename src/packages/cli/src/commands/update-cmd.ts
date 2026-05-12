import { join } from 'node:path';
import {
  readMemoryMap,
  writeMemoryMap,
  updateNodeMeta,
  upsertNode,
} from '@mastishk/core';
import type { MskStatus } from '@mastishk/core';
import { mastishkDir, memoryMapPath, assertMastishkExists } from '../utils.js';

export interface UpdateOptions {
  cwd?: string;
  status?: string;
  confidence?: string;
}

export async function updateCommand(id: string, options: UpdateOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  await assertMastishkExists(cwd);

  const map = await readMemoryMap(memoryMapPath(cwd));
  const entry = map.nodes[id];
  if (!entry) throw new Error(`Node "${id}" not found in memory-map.json.`);

  const filePath = join(mastishkDir(cwd), entry.file);

  // Build only the updates the caller specified
  const metaUpdates: Parameters<typeof updateNodeMeta>[1] = {
    last_updated_by: 'mastishk-cli',
  };
  if (options.status !== undefined) {
    metaUpdates.status = options.status as MskStatus;
  }
  if (options.confidence !== undefined) {
    const conf = parseFloat(options.confidence);
    if (isNaN(conf) || conf < 0 || conf > 1) {
      throw new Error(`--confidence must be a float between 0.0 and 1.0 (got "${options.confidence}").`);
    }
    metaUpdates.confidence = conf;
  }

  // updateNodeMeta preserves body — does NOT trigger state-layer append
  await updateNodeMeta(filePath, metaUpdates);

  // Sync the memory-map entry
  const updatedEntry = {
    ...entry,
    ...(metaUpdates.status !== undefined && { status: metaUpdates.status }),
    ...(metaUpdates.confidence !== undefined && { confidence: metaUpdates.confidence }),
  };
  await writeMemoryMap(memoryMapPath(cwd), upsertNode(map, id, updatedEntry));

  console.log(`Updated "${id}"${options.status ? ` → status: ${options.status}` : ''}${options.confidence ? ` → confidence: ${options.confidence}` : ''}.`);
}
