import { inject } from '@mastishk/core';
import { mastishkDir, assertMastishkExists } from '../utils.js';

export interface InjectOptions {
  cwd?: string;
}

export async function injectCommand(task: string, options: InjectOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  await assertMastishkExists(cwd);
  const result = await inject(task, mastishkDir(cwd));
  console.log(result);
  return result;
}
