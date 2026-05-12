// SPEC-GAP: scan command is mentioned in spec section 10 but inference rules are not defined.
// We infer from package.json, git log, and README.md. All inference is best-effort and graceful.
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  writeNode,
  readMemoryMap,
  writeMemoryMap,
  upsertNode,
} from '@mastishk/core';
import type { MskNode, MskLayer, MskType, MemoryMapNode } from '@mastishk/core';
import { mastishkDir, memoryMapPath, assertMastishkExists } from '../utils.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ScanCandidate {
  node: MskNode;
  source: 'package.json' | 'git-log' | 'readme';
}

export interface ScanOptions {
  cwd?: string;
  // For testing: bypass interactive confirmation
  autoConfirm?: 'yes' | 'no';
  confirm?: (node: MskNode, i: number, total: number) => Promise<'yes' | 'no'>;
}

function toKebab(str: string): string {
  return str
    .toLowerCase()
    .replace(/^@[^/]+\//, '') // strip npm scope
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function makeScannedNode(
  id: string,
  type: MskType,
  layer: MskLayer,
  body: string,
  overrides: Partial<MskNode> = {}
): MskNode {
  const now = new Date().toISOString();
  return {
    id,
    type,
    layer,
    status: 'active',
    confidence: 0.6,
    created_by: 'mastishk-scan',
    created_at: now,
    last_updated_by: 'mastishk-scan',
    last_updated_at: now,
    dependencies: [],
    contradictions: [],
    tags: ['scanned'],
    scanned: true,
    body,
    ...overrides,
  };
}

async function inferFromPackageJson(cwd: string): Promise<ScanCandidate[]> {
  const candidates: ScanCandidate[] = [];
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const name = typeof pkg['name'] === 'string' ? pkg['name'] : '';
    const description = typeof pkg['description'] === 'string' ? pkg['description'] : '';
    const version = typeof pkg['version'] === 'string' ? pkg['version'] : '';

    if (name) {
      const slug = toKebab(name);
      const body = [
        `Project: ${name}`,
        version ? `Version: ${version}` : '',
        description ? description : '',
      ]
        .filter(Boolean)
        .join('\n');
      candidates.push({
        source: 'package.json',
        node: makeScannedNode(`fact-${slug}-project`, 'fact', 'knowledge', body),
      });

      const deps = pkg['dependencies'];
      if (deps && typeof deps === 'object') {
        const depList = Object.keys(deps as Record<string, unknown>);
        if (depList.length > 0) {
          candidates.push({
            source: 'package.json',
            node: makeScannedNode(
              `fact-${slug}-deps`,
              'fact',
              'knowledge',
              `Runtime dependencies: ${depList.join(', ')}`
            ),
          });
        }
      }

      const devDeps = pkg['devDependencies'];
      if (devDeps && typeof devDeps === 'object') {
        const devList = Object.keys(devDeps as Record<string, unknown>);
        if (devList.length > 0) {
          candidates.push({
            source: 'package.json',
            node: makeScannedNode(
              `fact-${slug}-devdeps`,
              'fact',
              'knowledge',
              `Dev dependencies: ${devList.join(', ')}`
            ),
          });
        }
      }
    }
  } catch {
    // package.json missing or invalid — skip
  }
  return candidates;
}

async function inferFromGitLog(cwd: string): Promise<ScanCandidate[]> {
  const candidates: ScanCandidate[] = [];
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, 'log', '--oneline', '-10']);
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) continue;
      const hash = line.slice(0, spaceIdx);
      const message = line.slice(spaceIdx + 1).trim();
      const slug = hash.slice(0, 7);
      candidates.push({
        source: 'git-log',
        node: makeScannedNode(
          `task-commit-${slug}`,
          'task',
          'state',
          message,
          { status: 'resolved' }
        ),
      });
    }
  } catch {
    // not a git repo or git not available — skip
  }
  return candidates;
}

async function inferFromReadme(cwd: string): Promise<ScanCandidate[]> {
  const candidates: ScanCandidate[] = [];
  const readmePaths = ['README.md', 'readme.md', 'Readme.md'];
  for (const name of readmePaths) {
    try {
      await access(join(cwd, name));
      const raw = await readFile(join(cwd, name), 'utf-8');
      const lines = raw.split('\n');

      // Find first # heading
      const headingLine = lines.find((l) => l.startsWith('# '));
      if (!headingLine) break;
      const title = headingLine.replace(/^# /, '').trim();
      const slug = toKebab(title);

      // Find first non-empty paragraph after heading
      let body = title;
      let pastHeading = false;
      for (const line of lines) {
        if (line.startsWith('# ')) { pastHeading = true; continue; }
        if (pastHeading && line.trim().length > 0 && !line.startsWith('#')) {
          body = line.trim();
          break;
        }
      }

      candidates.push({
        source: 'readme',
        node: makeScannedNode(`goal-${slug}-readme`, 'goal', 'intent', body),
      });
      break;
    } catch {
      // try next
    }
  }
  return candidates;
}

export async function scanInfer(cwd: string): Promise<ScanCandidate[]> {
  const results = await Promise.all([
    inferFromPackageJson(cwd),
    inferFromGitLog(cwd),
    inferFromReadme(cwd),
  ]);
  return results.flat();
}

export async function scanCommand(options: ScanOptions = {}): Promise<{ added: string[]; skipped: string[] }> {
  const cwd = options.cwd ?? process.cwd();
  await assertMastishkExists(cwd);

  const candidates = await scanInfer(cwd);
  const map = await readMemoryMap(memoryMapPath(cwd));

  // Filter out IDs already in memory-map
  const newCandidates = candidates.filter((c) => !map.nodes[c.node.id]);

  const added: string[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < newCandidates.length; i++) {
    const { node, source } = newCandidates[i]!;

    let decision: 'yes' | 'no' = 'yes';

    if (options.autoConfirm) {
      decision = options.autoConfirm;
    } else if (options.confirm) {
      decision = await options.confirm(node, i + 1, newCandidates.length);
    }

    if (decision === 'no') {
      skipped.push(node.id);
      continue;
    }

    const relativeFile = `${node.layer}/${node.id}.msk.md`;
    const filePath = join(mastishkDir(cwd), relativeFile);
    await writeNode(filePath, node);

    const updatedMap = await readMemoryMap(memoryMapPath(cwd));
    const entry: MemoryMapNode = {
      file: relativeFile,
      layer: node.layer,
      type: node.type,
      status: node.status,
      confidence: node.confidence,
      dependencies: node.dependencies,
      tags: node.tags,
    };
    await writeMemoryMap(memoryMapPath(cwd), upsertNode(updatedMap, node.id, entry));

    console.log(`[${source}] Added ${node.id}`);
    added.push(node.id);
  }

  console.log(`Scan complete. Added: ${added.length}, Skipped: ${skipped.length + (candidates.length - newCandidates.length)} (${candidates.length - newCandidates.length} already in memory).`);
  return { added, skipped };
}
