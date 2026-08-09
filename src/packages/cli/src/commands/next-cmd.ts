import { join } from 'node:path';
import { readMemoryMap, readNode, findNextPlanStep } from '@mastishk/core';
import type { MskNode } from '@mastishk/core';
import { mastishkDir, memoryMapPath, assertMastishkExists } from '../utils.js';

// Spec section 11 — `mastishk next` MUST print the first unblocked step of the
// most recently updated active plan node, or `No active plan.` if none exists.

export const NO_ACTIVE_PLAN = 'No active plan.';

export interface NextCommandOptions {
  cwd?: string;
}

export interface NextCommandResult {
  /** The step node ID, or null when there is no active plan or nothing unblocked. */
  stepId: string | null;
}

export async function nextCommand(
  options: NextCommandOptions = {}
): Promise<NextCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  await assertMastishkExists(cwd);
  const dir = mastishkDir(cwd);

  const map = await readMemoryMap(memoryMapPath(cwd));
  const nodes: Record<string, MskNode> = {};
  await Promise.all(
    Object.entries(map.nodes).map(async ([id, entry]) => {
      try {
        nodes[id] = await readNode(join(dir, entry.file));
      } catch {
        // Unreadable nodes are doctor's business (spec 11), not next's.
      }
    })
  );

  const hasActivePlan = Object.values(nodes).some(
    (n) => n.type === 'plan' && n.status === 'active'
  );
  if (!hasActivePlan) {
    console.log(NO_ACTIVE_PLAN);
    return { stepId: null };
  }

  const stepId = findNextPlanStep(nodes);
  if (!stepId) {
    // An active plan whose steps are all done or all blocked is not "no plan" —
    // saying so would send the agent looking for a plan that exists.
    console.log('Active plan has no unblocked step — every step is resolved or blocked.');
    return { stepId: null };
  }

  const step = nodes[stepId];
  console.log(stepId);
  if (step) {
    const firstLine = step.body.split('\n').find((l) => l.trim().length > 0);
    if (firstLine) console.log(`  ${firstLine.trim()}`);
  }
  return { stepId };
}
