// SPEC-GAP: interactive goal prompt on init not in spec section 10 — proposed as spec section 11
// SPEC-GAP: CLAUDE.md auto-create (when absent) not in spec section 10 — spec only says append if exists
// SPEC-GAP: git hook installation not in spec — proposed as spec section 12
import { mkdir, writeFile, readFile, access, chmod, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createEmptyMemoryMap,
  writeMemoryMap,
  writeNode,
  readMemoryMap,
  upsertNode,
} from '@mastishk/core';
import type { MskNode, MemoryMapNode } from '@mastishk/core';
import { mastishkDir, memoryMapPath } from '../utils.js';

// Default agents.json per spec section 8
const DEFAULT_AGENTS = {
  version: '0.1',
  conflict_strategy: 'flag',
  write_back: 'required',
  registered_agents: [
    { id: 'claude-code', access: 'read-write', trust: 'high' },
    { id: 'cursor', access: 'read-write', trust: 'high' },
    { id: 'custom-agent', access: 'read-write', trust: 'medium' },
  ],
};

// SPEC-GAP: richer CLAUDE.md briefing format proposed as spec section 13
export const CLAUDE_MD_SECTION = `
## Mastishk memory

This project uses Mastishk for persistent agent memory.
Memory lives in \`.mastishk/\` — do not edit these files manually.

**At the start of every session — do this first, before anything else:**
Run \`mastishk inject "<task>"\` and read the full output.
It contains your goals, current state, constraints, and open issues.
Do not start work until you have read it.

**During the session:**
- If you complete a task: update its status in \`state/\`
- If you hit an error: log it with \`mastishk log\`
- If you learn something about the architecture: add it to \`knowledge/\`

**At the end of every session:**
- Update \`.mastishk/state/progress.msk.md\` with what was done
- Run \`mastishk checkpoint\` to commit memory state to git

**Memory layers:**
- \`.mastishk/intent/\` — goals and constraints. Never modify without human confirmation.
- \`.mastishk/state/\` — current tasks and progress. Update freely.
- \`.mastishk/knowledge/\` — architecture and decisions. Add as you learn.
- \`.mastishk/issues/\` — errors and blockers. Always log, never delete.
`;

export interface InitAnswers {
  what: string;
  goal: string;
  targetDate?: string;
  constraints?: string;
  currentStatus?: string;
}

export interface InitOptions {
  cwd?: string;
  // SPEC-GAP: --template defined in spec section 10 but no templates are defined yet
  template?: string;
  // For testing: bypass interactive prompts
  skipPrompt?: boolean;
  // For testing: pre-set answers (skips @inquirer/prompts)
  answers?: InitAnswers;
}

async function hasIntentNodes(dir: string): Promise<boolean> {
  try {
    const files = await readdir(join(dir, 'intent'));
    return files.some((f) => f.endsWith('.msk.md'));
  } catch {
    return false;
  }
}

async function writeInitNode(cwd: string, node: MskNode): Promise<void> {
  const relFile = `${node.layer}/${node.id}.msk.md`;
  const filePath = join(mastishkDir(cwd), relFile);
  await writeNode(filePath, node);
  const map = await readMemoryMap(memoryMapPath(cwd));
  const entry: MemoryMapNode = {
    file: relFile,
    layer: node.layer,
    type: node.type,
    status: node.status,
    confidence: node.confidence,
    dependencies: node.dependencies,
    tags: node.tags,
  };
  await writeMemoryMap(memoryMapPath(cwd), upsertNode(map, node.id, entry));
}

export async function injectClaudeMd(cwd: string): Promise<boolean> {
  const claudeMdPath = join(cwd, 'CLAUDE.md');
  try {
    const existing = await readFile(claudeMdPath, 'utf-8');
    if (!existing.includes('## Mastishk memory')) {
      await writeFile(claudeMdPath, existing + CLAUDE_MD_SECTION, 'utf-8');
      return true;
    }
    return false; // already has section
  } catch {
    // CLAUDE.md does not exist — create it
    await writeFile(claudeMdPath, CLAUDE_MD_SECTION.trimStart(), 'utf-8');
    return true;
  }
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const dir = mastishkDir(cwd);

  let alreadyExists = false;
  try {
    await access(dir);
    alreadyExists = true;
  } catch {
    // expected — doesn't exist yet
  }

  if (alreadyExists) {
    console.warn(`Warning: .mastishk/ already exists at ${dir}. Re-initialising.`);
  }

  // Create folder structure
  for (const layer of ['intent', 'state', 'knowledge', 'issues']) {
    await mkdir(join(dir, layer), { recursive: true });
  }

  // Spec section 10: memory-map.json with empty nodes and edges
  await writeMemoryMap(memoryMapPath(cwd), createEmptyMemoryMap());

  // Spec section 8: agents.json with default config
  await writeFile(
    join(dir, 'agents.json'),
    JSON.stringify(DEFAULT_AGENTS, null, 2) + '\n',
    'utf-8'
  );

  // Determine if we should run interactive prompts
  const intentEmpty = !(await hasIntentNodes(dir));
  const isInteractive = process.stdout.isTTY === true;
  const shouldPrompt =
    intentEmpty && !options.skipPrompt && (options.answers !== undefined || isInteractive);

  let answers: InitAnswers | undefined;

  if (shouldPrompt) {
    if (options.answers) {
      answers = options.answers;
    } else {
      // Dynamic import so tests can run without a TTY loading @inquirer/prompts
      const { input } = await import('@inquirer/prompts');
      const what = await input({ message: 'What are you building?', required: true });
      const goal = await input({ message: 'What is the main goal?', required: true });
      const targetDate =
        (await input({ message: 'Target date or milestone? (enter to skip)' })) || undefined;
      const constraints =
        (await input({
          message: 'Hard constraints? (stack, budget, things to avoid) (enter to skip)',
        })) || undefined;
      const currentStatus =
        (await input({ message: 'Current status? (enter if fresh project)' })) || undefined;
      answers = { what, goal, targetDate, constraints, currentStatus };
    }
  }

  const writtenNodes: string[] = [];

  if (answers) {
    const now = new Date().toISOString();
    const goalParts = [answers.what, answers.goal];
    if (answers.targetDate) goalParts.push(`Target: ${answers.targetDate}`);
    const goalBody = goalParts.join('\n');

    await writeInitNode(cwd, {
      id: 'goal-main',
      type: 'goal',
      layer: 'intent',
      status: 'active',
      confidence: 1.0,
      created_by: 'human',
      created_at: now,
      last_updated_by: 'human',
      last_updated_at: now,
      dependencies: [],
      contradictions: [],
      body: goalBody,
    });
    writtenNodes.push('goals.msk.md');

    if (answers.constraints) {
      await writeInitNode(cwd, {
        id: 'constraints-main',
        type: 'constraint',
        layer: 'intent',
        status: 'active',
        confidence: 1.0,
        created_by: 'human',
        created_at: now,
        last_updated_by: 'human',
        last_updated_at: now,
        dependencies: [],
        contradictions: [],
        body: answers.constraints,
      });
      writtenNodes.push('constraints.msk.md');
    }

    const progressBody = answers.currentStatus ?? 'Fresh project — nothing built yet.';
    await writeInitNode(cwd, {
      id: 'progress-initial',
      type: 'task',
      layer: 'state',
      status: 'active',
      confidence: 1.0,
      created_by: 'human',
      created_at: now,
      last_updated_by: 'human',
      last_updated_at: now,
      dependencies: [],
      contradictions: [],
      body: progressBody,
    });
    writtenNodes.push('progress.msk.md');
  }

  // Spec section 10 + SPEC-GAP: also create CLAUDE.md if absent
  const claudeMdUpdated = await injectClaudeMd(cwd);

  // SPEC-GAP: git hook installation proposed as spec section 12
  let hookInstalled = false;
  const gitDir = join(cwd, '.git');
  try {
    await access(gitDir);
    const hookDir = join(gitDir, 'hooks');
    await mkdir(hookDir, { recursive: true });
    const hookPath = join(hookDir, 'post-commit');
    await writeFile(hookPath, '#!/bin/sh\nnpx @mastishk/cli hook\n', 'utf-8');
    try {
      await chmod(hookPath, 0o755);
    } catch {
      // chmod may be a no-op on Windows; hook content still correct
    }
    hookInstalled = true;
  } catch {
    // No .git/ — skip silently
  }

  // Summary
  console.log('\n✅ Created .mastishk/ structure');
  if (writtenNodes.includes('goals.msk.md')) console.log('✅ Wrote goals.msk.md');
  if (writtenNodes.includes('constraints.msk.md')) console.log('✅ Wrote constraints.msk.md');
  if (writtenNodes.includes('progress.msk.md')) console.log('✅ Wrote progress.msk.md');
  if (claudeMdUpdated) console.log('✅ Updated CLAUDE.md with Mastishk briefing');
  if (hookInstalled)
    console.log('✅ Git hook installed — memory updates automatically on every commit.');
  console.log('\n🎉 Done. Open your coding agent — it already knows your project.');
  if (options.template) {
    console.log('Note: --template is not yet implemented. Used default template.');
  }
}
