// These three behaviours were SPEC-GAPs in v0.2 and are now specified in v0.3:
// the interactive goal prompt (section 12.5), creating the instruction file when
// absent (section 14.2), and post-commit hook installation (section 16.1).
import { mkdir, writeFile, readFile, access, chmod, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createEmptyMemoryMap,
  writeMemoryMap,
  writeNode,
  readMemoryMap,
  upsertNode,
  nodeToMapEntry,
} from '@mastishk/core';
import type { MskNode } from '@mastishk/core';
import { mastishkDir, memoryMapPath } from '../utils.js';
import { injectAllBriefings } from './onboarding.js';

// Default agents.json per spec section 9. The reference CLI and MCP server act
// on behalf of the human / primary agents, so they register as high trust;
// projects can demote them in agents.json.
const DEFAULT_AGENTS = {
  version: '0.3',
  conflict_strategy: 'flag',
  write_back: 'required',
  session_timeout_hours: 8,
  registered_agents: [
    { id: 'claude-code', access: 'read-write', trust: 'high', last_session_at: null },
    { id: 'cursor', access: 'read-write', trust: 'high', last_session_at: null },
    { id: 'mastishk-cli', access: 'read-write', trust: 'high', last_session_at: null },
    { id: 'mastishk-mcp', access: 'read-write', trust: 'high', last_session_at: null },
    { id: 'custom-agent', access: 'read-write', trust: 'medium', last_session_at: null },
  ],
};

// Spec section 14.3 — the canonical briefing lives in onboarding.ts and is shared
// by init and instruct. Re-exported here for the existing import surface.
export { MASTISHK_SECTION as CLAUDE_MD_SECTION } from './onboarding.js';

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
  await writeMemoryMap(memoryMapPath(cwd), upsertNode(map, node.id, nodeToMapEntry(node, relFile)));
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

  // Create folder structure (spec section 3 — v0.3 adds map/ and sessions/)
  for (const layer of ['intent', 'state', 'knowledge', 'map', 'issues', 'sessions']) {
    await mkdir(join(dir, layer), { recursive: true });
  }

  // Spec section 3: sessions/ is ephemeral and excluded from version control
  await writeFile(join(dir, '.gitignore'), 'sessions/\n.lock\n', 'utf-8');

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

  // Spec section 14 — AGENTS.md is canonical, CLAUDE.md is its mirror
  const briefings = await injectAllBriefings(cwd);
  const briefingsWritten = briefings.filter((b) => b.outcome !== 'unchanged');

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
  for (const b of briefingsWritten) {
    console.log(`✅ ${b.outcome === 'created' ? 'Created' : 'Updated'} ${b.file} with Mastishk briefing`);
  }
  if (hookInstalled)
    console.log('✅ Git hook installed — memory updates automatically on every commit.');
  console.log('\n🎉 Done. Open your coding agent — it already knows your project.');
  if (options.template) {
    console.log('Note: --template is not yet implemented. Used default template.');
  }
}
