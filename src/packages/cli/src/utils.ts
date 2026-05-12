import { join } from 'node:path';
import { access } from 'node:fs/promises';

export function mastishkDir(cwd: string): string {
  return join(cwd, '.mastishk');
}

export function memoryMapPath(cwd: string): string {
  return join(mastishkDir(cwd), 'memory-map.json');
}

export async function assertMastishkExists(cwd: string): Promise<void> {
  try {
    await access(mastishkDir(cwd));
  } catch {
    throw new Error(
      `No .mastishk/ folder found in ${cwd}. Run "mastishk init" first.`
    );
  }
}
