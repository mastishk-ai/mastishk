// SPEC-GAP: scan command is mentioned in spec section 10 but inference rules are not defined.
// We infer from package.json, git log, and README.md. All inference is best-effort and graceful.
import { readFile, access, readdir } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import {
  writeNode,
  readMemoryMap,
  writeMemoryMap,
  upsertNode,
  nodeToMapEntry,
  makeMapNode,
} from '@mastishk/core';
import type { MskNode, MskLayer, MskType } from '@mastishk/core';
import { mastishkDir, memoryMapPath, assertMastishkExists } from '../utils.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ScanCandidate {
  node: MskNode;
  source: 'package.json' | 'git-log' | 'readme' | 'source-walk';
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

// Spec section 11 [v0.3] — walk significant source files and generate map nodes.
// "Significant" is deliberately conservative: scan seeds the map with low-confidence
// entries that agents refine during sessions. A wrong entry costs more than a
// missing one (spec 4.4), so we prefer to under-generate.

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cs', '.php',
]);

const SKIP_DIRS = new Set([
  // build output and dependencies
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
  'vendor', '__pycache__', '.venv', 'venv', 'target', '.mastishk', '.cache',
  // Not the codebase's substance. An agent asking "which file does what" wants
  // the code under maintenance, not the suite that exercises it or the samples
  // that document it. Mapping these buries the useful entries: on a real repo
  // (sindresorhus/got) they were 15 of 40 entries.
  'test', 'tests', '__tests__', 'spec', 'e2e', 'fixtures', '__fixtures__',
  'benchmark', 'benchmarks', 'bench',
  'example', 'examples', 'docs', 'documentation',
]);

// Test files describe the code under test, not the codebase itself.
const TEST_PATTERN = /\.(test|spec)\.[^.]+$/;

const MAX_MAP_NODES = 40;
const MAX_WALK_DEPTH = 6;

async function walkSourceFiles(
  root: string,
  dir: string,
  depth: number,
  acc: string[]
): Promise<void> {
  if (depth > MAX_WALK_DEPTH || acc.length >= MAX_MAP_NODES) return;
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of dirents) {
    if (acc.length >= MAX_MAP_NODES) return;
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkSourceFiles(root, full, depth + 1, acc);
    } else if (entry.isFile()) {
      if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
      if (TEST_PATTERN.test(entry.name)) continue;
      acc.push(full.slice(root.length + 1).replace(/\\/g, '/'));
    }
  }
}

/**
 * A one-line purpose summary for a source file (spec 11). Prefers a leading
 * file comment, since that is the author's own description; falls back to the
 * exported surface, which at least tells an agent what the file offers.
 */
export function summariseSourceFile(relPath: string, content: string): string {
  const lines = content.split('\n');

  // A leading // or # comment block, or a /** */ docblock
  const commentLines: string[] = [];
  for (const raw of lines.slice(0, 15)) {
    const line = raw.trim();
    if (line.length === 0 && commentLines.length === 0) continue;
    const stripped = line
      .replace(/^\/\*\*?/, '')
      .replace(/^\*\//, '')
      .replace(/^\*/, '')
      .replace(/^\/\//, '')
      .replace(/^#(?!!)/, '')
      .trim();
    const isComment = /^(\/\/|#(?!!)|\/\*|\*)/.test(line);
    if (!isComment) break;
    if (stripped.length > 0) commentLines.push(stripped);
    if (commentLines.length >= 2) break;
  }
  if (commentLines.length > 0) {
    return commentLines.join(' ').slice(0, 240);
  }

  // Fall back to the file's public surface. Explicit exports are the strongest
  // signal, so look for those first and only report them as "Exports".
  const exported = new Set<string>();
  for (const line of lines) {
    const m = /^export\s+(?:async\s+)?(?:function|class|const|interface|type|enum)\s+([A-Za-z0-9_$]+)/.exec(line);
    if (m?.[1]) exported.add(m[1]);
    if (exported.size >= 8) break;
  }
  if (exported.size > 0) {
    return `Exports: ${[...exported].join(', ')}.`;
  }

  // Languages without an export keyword (Python, Go, Rust) put their API at the
  // top level. Report those as "Defines" — calling them exports would be a lie,
  // and a map entry that lies is worse than no entry at all. `type` is excluded
  // deliberately: a local generic helper is not the file's purpose.
  const defined = new Set<string>();
  for (const line of lines) {
    const m = /^(?:public\s+)?(?:class|def|func|fn)\s+([A-Za-z0-9_$]+)/.exec(line);
    if (m?.[1]) defined.add(m[1]);
    if (defined.size >= 8) break;
  }
  if (defined.size > 0) {
    return `Defines: ${[...defined].join(', ')}.`;
  }

  return `Source file ${basename(relPath)}. Purpose not inferred — refine this entry.`;
}

async function inferMapNodes(cwd: string): Promise<ScanCandidate[]> {
  const paths: string[] = [];
  await walkSourceFiles(cwd, cwd, 0, paths);

  const candidates: ScanCandidate[] = [];
  // toKebab truncates, so two deep paths can collapse to the same id. IDs must be
  // unique project-wide (spec 3.1), so disambiguate rather than silently drop.
  const usedIds = new Set<string>();

  for (const relPath of paths) {
    let content = '';
    try {
      content = await readFile(join(cwd, relPath), 'utf-8');
    } catch {
      continue;
    }
    const summary = summariseSourceFile(relPath, content);
    const base = `map-${toKebab(relPath.replace(/\.[^.]+$/, ''))}`;
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    usedIds.add(id);

    candidates.push({
      source: 'source-walk',
      node: makeMapNode(id, relPath, `${summary}\n\nPath: \`${relPath}\``),
    });
  }
  return candidates;
}

export async function scanInfer(cwd: string): Promise<ScanCandidate[]> {
  const results = await Promise.all([
    inferFromPackageJson(cwd),
    inferFromGitLog(cwd),
    inferFromReadme(cwd),
    inferMapNodes(cwd),
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
    await writeMemoryMap(memoryMapPath(cwd), upsertNode(updatedMap, node.id, nodeToMapEntry(node, relativeFile)));

    console.log(`[${source}] Added ${node.id}`);
    added.push(node.id);
  }

  console.log(`Scan complete. Added: ${added.length}, Skipped: ${skipped.length + (candidates.length - newCandidates.length)} (${candidates.length - newCandidates.length} already in memory).`);
  return { added, skipped };
}
