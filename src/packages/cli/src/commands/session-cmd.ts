import {
  sessionStart,
  sessionEnd,
  readActiveSessions,
} from '@mastishk/core';
import type { SessionStartResult, SessionEndResult } from '@mastishk/core';
import { mastishkDir, assertMastishkExists } from '../utils.js';
import { checkpointCommand } from './checkpoint.js';

export interface SessionStartOptions {
  agent: string;
  task?: string;
  cwd?: string;
}

// Spec section 15.1 — mastishk session start --agent <id> [--task <task>]
export async function sessionStartCommand(
  options: SessionStartOptions
): Promise<SessionStartResult> {
  const cwd = options.cwd ?? process.cwd();
  await assertMastishkExists(cwd);

  const task = options.task ?? 'general work on this project';
  const result = await sessionStart(mastishkDir(cwd), options.agent, task);

  if (result.presence.length > 0) {
    console.log('⚠ Other agents are active on this project:');
    for (const s of result.presence) {
      console.log(`  - ${s.agent} since ${s.started_at} — "${s.task}"`);
    }
    console.log('');
  }
  console.log(result.catchup);
  console.log('');
  console.log(result.context);
  return result;
}

export interface SessionEndOptions {
  agent?: string;
  handoff?: string;
  cwd?: string;
}

// Spec section 15.2 — mastishk session end [--handoff <text>]
export async function sessionEndCommand(
  options: SessionEndOptions = {}
): Promise<SessionEndResult> {
  const cwd = options.cwd ?? process.cwd();
  await assertMastishkExists(cwd);
  const dir = mastishkDir(cwd);

  // Resolve which agent's session is ending.
  let agent = options.agent;
  if (!agent) {
    const active = await readActiveSessions(dir);
    if (active.length === 1) {
      agent = active[0].agent;
    } else if (active.length === 0) {
      throw new Error('No active session. Pass --agent <id> to end a session explicitly.');
    } else {
      throw new Error(
        `Multiple active sessions (${active.map((s) => s.agent).join(', ')}). Pass --agent <id>.`
      );
    }
  }

  let handoff = options.handoff;
  // Spec 15.2 — without --handoff, prompt when interactive; warn otherwise.
  if (!handoff && process.stdin.isTTY && process.stdout.isTTY) {
    const { input } = await import('@inquirer/prompts');
    const done = await input({ message: 'Done — what was completed this session?' });
    const inFlight = await input({ message: 'In flight — what is half-finished, and where?' });
    const watchOut = await input({ message: 'Watch out — what should the next session not break?' });
    const next = await input({ message: 'Next — what should be picked up first?' });
    const parts = [
      done && `**Done:** ${done}`,
      inFlight && `**In flight:** ${inFlight}`,
      watchOut && `**Watch out:** ${watchOut}`,
      next && `**Next:** ${next}`,
    ].filter(Boolean);
    handoff = parts.join('\n');
  }

  const result = await sessionEnd(dir, agent, { handoff });
  if (result.handoffId) console.log(`Handoff written: ${result.handoffId}`);
  if (result.warning) console.log(`⚠ ${result.warning}`);

  // Spec 15.2 step 4 — checkpoint; degrade gracefully outside a git repo.
  try {
    await checkpointCommand({ cwd, message: `mastishk: session end — ${agent}` });
  } catch (err) {
    console.log(
      `⚠ Checkpoint skipped: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  console.log(`Session ended for ${agent}.`);
  return result;
}
