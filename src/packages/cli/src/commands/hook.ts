// SPEC-GAP: git hook automation not in spec — proposed as spec section 12
// This command runs automatically after every git commit via the post-commit hook
// installed by `mastishk init`. It reads the commit and updates state memory.
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  readMemoryMap,
  writeMemoryMap,
  writeNode,
  readNode,
} from '@mastishk/core';
import type { MskNode } from '@mastishk/core';
import { mastishkDir, memoryMapPath } from '../utils.js';

const execFileAsync = promisify(execFile);

export interface HookOptions {
  cwd?: string;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function classifyCommit(msg: string): 'feat' | 'fix' | 'wip' | null {
  if (/^(feat|add):/i.test(msg)) return 'feat';
  if (/^fix:/i.test(msg)) return 'fix';
  if (/^wip:/i.test(msg)) return 'wip';
  return null;
}

function buildAppendBody(kind: 'feat' | 'fix' | 'wip', commitMsg: string): string {
  const label = kind === 'feat' ? 'Completed' : kind === 'fix' ? 'Fixed' : 'In progress';
  return `${label}: ${commitMsg}`;
}

async function findStateTaskFile(cwd: string): Promise<string | null> {
  const dir = mastishkDir(cwd);
  const map = await readMemoryMap(memoryMapPath(cwd));
  const entry = Object.entries(map.nodes).find(
    ([, n]) => n.layer === 'state' && n.type === 'task'
  );
  if (entry) {
    const candidate = join(dir, entry[1].file);
    if (await fileExists(candidate)) return candidate;
  }
  // Fallback: scan state/ directory for any .msk.md file
  try {
    const stateDir = join(dir, 'state');
    const files = await readdir(stateDir);
    const first = files.find((f) => f.endsWith('.msk.md'));
    if (first) return join(stateDir, first);
  } catch {
    // no state dir
  }
  return null;
}

export async function hookCommand(options: HookOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  // Ensure .mastishk/ exists — silently exit if not (hook may run in non-mastishk repos)
  if (!(await fileExists(mastishkDir(cwd)))) return;

  // Read git commit info
  let commitMsg = '';
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, 'log', '-1', '--pretty=%s']);
    commitMsg = stdout.trim();
  } catch {
    return; // not a git repo or no commits
  }

  const kind = classifyCommit(commitMsg);
  if (!kind) return; // only handle feat/add/fix/wip prefixes

  const stateFilePath = await findStateTaskFile(cwd);
  const now = new Date().toISOString();

  if (stateFilePath) {
    // Append to existing state node via writeNode (append-only per spec section 7.2)
    const existing = await readNode(stateFilePath);
    const appendNode: MskNode = {
      ...existing,
      last_updated_by: 'git-hook',
      last_updated_at: now,
      body: buildAppendBody(kind, commitMsg),
    };
    await writeNode(stateFilePath, appendNode);
  } else {
    // No existing state file — create one
    const dir = mastishkDir(cwd);
    const filePath = join(dir, 'state', 'progress.msk.md');
    const newNode: MskNode = {
      id: 'progress',
      type: 'task',
      layer: 'state',
      status: 'active',
      confidence: 1.0,
      created_by: 'git-hook',
      created_at: now,
      last_updated_by: 'git-hook',
      last_updated_at: now,
      dependencies: [],
      contradictions: [],
      body: buildAppendBody(kind, commitMsg),
    };
    await writeNode(filePath, newNode);

    // Register in memory-map
    const map = await readMemoryMap(memoryMapPath(cwd));
    const relFile = 'state/progress.msk.md';
    map.nodes['progress'] = {
      file: relFile,
      layer: 'state',
      type: 'task',
      status: 'active',
      confidence: 1.0,
      dependencies: [],
    };
    map.updated_at = now;
    await writeMemoryMap(memoryMapPath(cwd), map);
  }

  // Always touch memory-map.json updated_at
  try {
    const map = await readMemoryMap(memoryMapPath(cwd));
    map.updated_at = now;
    await writeMemoryMap(memoryMapPath(cwd), map);
  } catch {
    // non-fatal
  }
}
