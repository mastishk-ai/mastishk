import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

// Spec section 14 — agent onboarding.
//
// AGENTS.md is the canonical location (the cross-agent instruction file adopted
// by the wider ecosystem); CLAUDE.md receives a mirror of the same section.
// The detection rules in 14.2 are identical for both files, so they live here
// once rather than being reimplemented per command.

/** Canonical onboarding files, in precedence order. AGENTS.md is canonical (14.1). */
export const ONBOARDING_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;

export const MASTISHK_HEADING = '## Mastishk memory';

// Spec section 14.3 — the canonical section format. This MUST contain the
// heading, the session-start instruction, the memory layers, and end-of-session
// instructions.
export const MASTISHK_SECTION = `
${MASTISHK_HEADING}

This project uses Mastishk for persistent shared agent memory.
Memory lives in \`.mastishk/\` — do not edit these files manually.
Multiple agents work on this project. Mastishk is the single brain they share.

**At the start of every session — do this first, before anything else:**
Run \`mastishk session start --agent <your-agent-id> --task "<task>"\`.
Read the full output: it contains the handoff from the previous session,
what changed since you were last here, goals, current state, constraints,
the codebase map, and open issues. Do not start work until you have read it.

**During the session:**
- If you complete a task: update its status in \`state/\`
- If you hit an error: log it with \`mastishk log\`
- If you learn something about the architecture: add it to \`knowledge/\`
- If a \`map/\` entry you rely on is marked (stale): verify it against the code and refresh it

**At the end of every session:**
Run \`mastishk session end\` and write a handoff covering:
Done / In flight / Watch out / Next.

**Memory layers:**
- \`.mastishk/intent/\` — goals, constraints, resources. Never modify without human confirmation.
- \`.mastishk/state/\` — tasks, plans, progress, handoffs. Update freely (append-only).
- \`.mastishk/knowledge/\` — architecture and decisions. Add as you learn.
- \`.mastishk/map/\` — which file does what. Keep fresh; trust is everything here.
- \`.mastishk/issues/\` — errors and blockers. Always log, never delete.
`;

export type OnboardingOutcome = 'created' | 'appended' | 'replaced' | 'unchanged';

export interface OnboardingResult {
  file: string;
  outcome: OnboardingOutcome;
}

/**
 * Spec section 14.2 — inject the briefing into one instruction file.
 *
 * - file exists without the heading  → append at the end
 * - file does not exist              → create it with the section as sole content
 * - file already has the heading     → leave unchanged, unless `replace` is set
 *
 * `replace` is what separates `instruct` (MAY replace with the current canonical
 * format) from `init` (MUST leave an existing section alone).
 */
export async function injectBriefing(
  cwd: string,
  fileName: string,
  options: { replace?: boolean } = {}
): Promise<OnboardingOutcome> {
  const filePath = join(cwd, fileName);

  let existing: string | null = null;
  try {
    existing = await readFile(filePath, 'utf-8');
  } catch {
    existing = null;
  }

  if (existing === null) {
    await writeFile(filePath, MASTISHK_SECTION.trimStart(), 'utf-8');
    return 'created';
  }

  const headingAt = existing.indexOf(MASTISHK_HEADING);

  if (headingAt === -1) {
    // Append, keeping exactly one blank line between the existing content and ours.
    const separator = existing.endsWith('\n') ? '' : '\n';
    await writeFile(filePath, existing + separator + MASTISHK_SECTION, 'utf-8');
    return 'appended';
  }

  if (!options.replace) return 'unchanged';

  // Replace our section in place, preserving anything the project wrote after it.
  const before = existing.slice(0, headingAt);
  const after = findContentAfterSection(existing, headingAt);
  await writeFile(
    filePath,
    before + MASTISHK_SECTION.trimStart() + after,
    'utf-8'
  );
  return 'replaced';
}

/**
 * Everything after our section ends — i.e. from the next same-level heading on.
 * Without this, replacing the section would silently delete any project content
 * that happens to follow it.
 */
function findContentAfterSection(content: string, headingAt: number): string {
  const rest = content.slice(headingAt + MASTISHK_HEADING.length);
  const nextHeading = rest.search(/\n## /);
  return nextHeading === -1 ? '' : rest.slice(nextHeading + 1);
}

/**
 * Spec section 14 — write the briefing to AGENTS.md (canonical) and mirror it
 * into CLAUDE.md.
 */
export async function injectAllBriefings(
  cwd: string,
  options: { replace?: boolean } = {}
): Promise<OnboardingResult[]> {
  const results: OnboardingResult[] = [];
  for (const file of ONBOARDING_FILES) {
    results.push({ file, outcome: await injectBriefing(cwd, file, options) });
  }
  return results;
}
