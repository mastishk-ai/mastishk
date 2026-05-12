import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mastishkDir, assertMastishkExists } from '../utils.js';

const execAsync = promisify(exec);

export interface CheckpointOptions {
  cwd?: string;
  message?: string;
}

export async function checkpointCommand(options: CheckpointOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  await assertMastishkExists(cwd);

  const dir = mastishkDir(cwd);
  const msg = options.message ?? `mastishk checkpoint — ${new Date().toISOString()}`;

  try {
    await execAsync(`git add "${dir}"`, { cwd });
    await execAsync(`git commit -m "${msg}"`, { cwd });
    console.log(`Checkpoint committed: ${msg}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Git checkpoint failed: ${message}`);
  }
}
