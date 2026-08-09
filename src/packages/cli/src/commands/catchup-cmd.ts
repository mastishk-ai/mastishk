import { catchup, readActiveSessions } from '@mastishk/core';
import { mastishkDir, assertMastishkExists } from '../utils.js';

export interface CatchupOptions {
  agent?: string;
  cwd?: string;
}

// Spec section 15.4 — mastishk catchup [--agent <id>]
// Without --agent: if exactly one session is active, use that agent; otherwise
// produce a full-history catchup for an anonymous reader.
export async function catchupCommand(options: CatchupOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  await assertMastishkExists(cwd);
  const dir = mastishkDir(cwd);

  let agent = options.agent;
  if (!agent) {
    const active = await readActiveSessions(dir);
    agent = active.length === 1 ? active[0].agent : 'anonymous';
  }

  const output = await catchup(dir, agent);
  console.log(output);
  return output;
}
