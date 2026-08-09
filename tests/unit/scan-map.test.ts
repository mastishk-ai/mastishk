import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  readMapEntries,
  readNode,
  writeMemoryMap,
  createEmptyMemoryMap,
  writeAgentsConfig,
  createDefaultAgentsConfig,
  commitNode,
  makeMapNode,
} from '@mastishk/core';
import { scanInfer, scanCommand, summariseSourceFile } from '../../src/packages/cli/src/commands/scan.js';
import { hookCommand } from '../../src/packages/cli/src/commands/hook.js';

const execFileAsync = promisify(execFile);

let tmpDir: string;
let mastishkDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-scanmap-'));
  mastishkDir = join(tmpDir, '.mastishk');
  await writeMemoryMap(join(mastishkDir, 'memory-map.json'), createEmptyMemoryMap());
  await writeAgentsConfig(mastishkDir, createDefaultAgentsConfig());
  for (const layer of ['intent', 'state', 'knowledge', 'map', 'issues']) {
    await mkdir(join(mastishkDir, layer), { recursive: true });
  }
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeSource(relPath: string, content: string): Promise<void> {
  const full = join(tmpDir, relPath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content, 'utf-8');
}

describe('summariseSourceFile — spec section 11', () => {
  it('prefers a leading line comment', () => {
    const s = summariseSourceFile('src/auth.ts', '// Signs and verifies JWTs.\nexport function sign() {}');
    expect(s).toContain('Signs and verifies JWTs.');
  });

  it('reads a docblock', () => {
    const s = summariseSourceFile('src/auth.ts', '/**\n * Token helpers.\n */\nexport const x = 1;');
    expect(s).toContain('Token helpers.');
  });

  it('reads a python-style comment', () => {
    const s = summariseSourceFile('src/auth.py', '# Password hashing helpers.\ndef hash_pw(): pass');
    expect(s).toContain('Password hashing helpers.');
  });

  it('falls back to the exported surface when there is no comment', () => {
    const s = summariseSourceFile('src/auth.ts', 'export function signToken() {}\nexport class Verifier {}');
    expect(s).toContain('Exports:');
    expect(s).toContain('signToken');
  });

  it('says so honestly when nothing can be inferred', () => {
    const s = summariseSourceFile('src/mystery.ts', 'const a = 1;\n');
    expect(s).toContain('Purpose not inferred');
  });

  it('does not mistake a shebang for a comment summary', () => {
    const s = summariseSourceFile('src/bin.ts', '#!/usr/bin/env node\nexport function main() {}');
    expect(s).toContain('Exports:');
  });
});

describe('scan → map nodes — spec section 11', () => {
  it('generates a map node per significant source file', async () => {
    await writeSource('src/auth.ts', '// Signs JWTs.\nexport function sign() {}');
    await writeSource('src/db.ts', '// Database client.\nexport function connect() {}');

    const candidates = await scanInfer(tmpDir);
    const mapNodes = candidates.filter((c) => c.node.layer === 'map');
    expect(mapNodes.map((c) => c.node.path).sort()).toEqual(['src/auth.ts', 'src/db.ts']);
  });

  it('marks generated map nodes scanned with confidence 0.6', async () => {
    await writeSource('src/auth.ts', '// Signs JWTs.\nexport function sign() {}');
    const mapNode = (await scanInfer(tmpDir)).find((c) => c.node.layer === 'map')!;
    expect(mapNode.node.confidence).toBe(0.6);
    expect(mapNode.node.scanned).toBe(true);
    expect(mapNode.node.type).toBe('file');
    expect(mapNode.node.stale).toBe(false);
  });

  it('skips node_modules, dist, and .git', async () => {
    await writeSource('node_modules/pkg/index.js', 'module.exports = {};');
    await writeSource('dist/bundle.js', 'var a=1;');
    await writeSource('src/real.ts', '// Real code.\nexport const x = 1;');

    const paths = (await scanInfer(tmpDir))
      .filter((c) => c.node.layer === 'map')
      .map((c) => c.node.path);
    expect(paths).toEqual(['src/real.ts']);
  });

  it('skips test files — they describe the code under test, not the codebase', async () => {
    await writeSource('src/auth.ts', '// Auth.\nexport const a = 1;');
    await writeSource('src/auth.test.ts', 'it("works", () => {});');
    await writeSource('src/auth.spec.ts', 'it("works", () => {});');

    const paths = (await scanInfer(tmpDir))
      .filter((c) => c.node.layer === 'map')
      .map((c) => c.node.path);
    expect(paths).toEqual(['src/auth.ts']);
  });

  it('skips non-source files', async () => {
    await writeSource('README.md', '# Title\n\nA project.');
    await writeSource('data.json', '{}');
    await writeSource('src/real.ts', '// Real.\nexport const x = 1;');

    const paths = (await scanInfer(tmpDir))
      .filter((c) => c.node.layer === 'map')
      .map((c) => c.node.path);
    expect(paths).toEqual(['src/real.ts']);
  });

  it('gives colliding truncated ids distinct suffixes (spec 3.1)', async () => {
    const deep = 'src/packages/application/services/internal/handlers';
    await writeSource(`${deep}/alpha.ts`, '// A.\nexport const a = 1;');
    await writeSource(`${deep}/beta.ts`, '// B.\nexport const b = 1;');

    const ids = (await scanInfer(tmpDir))
      .filter((c) => c.node.layer === 'map')
      .map((c) => c.node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('writes map nodes to map/ and indexes their path', async () => {
    await writeSource('src/auth.ts', '// Signs JWTs.\nexport function sign() {}');
    await scanCommand({ cwd: tmpDir, autoConfirm: 'yes' });

    const entries = await readMapEntries(mastishkDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe('src/auth.ts');
    expect(entries[0]!.stale).toBe(false);
  });
});

describe('hook staleness flagging — spec section 16.1 step 4', () => {
  async function initGitRepo(): Promise<void> {
    await execFileAsync('git', ['-C', tmpDir, 'init', '-q']);
    await execFileAsync('git', ['-C', tmpDir, 'config', 'user.email', 'test@example.com']);
    await execFileAsync('git', ['-C', tmpDir, 'config', 'user.name', 'Test']);
  }

  async function commitFile(relPath: string, content: string, message: string): Promise<void> {
    await writeSource(relPath, content);
    await execFileAsync('git', ['-C', tmpDir, 'add', '-A']);
    await execFileAsync('git', ['-C', tmpDir, 'commit', '-q', '-m', message]);
  }

  it('flags a map node when a commit touches its path', async () => {
    await initGitRepo();
    await commitNode(mastishkDir, makeMapNode('map-auth', 'src/auth.ts', 'Signs JWTs.', {
      created_by: 'x', last_updated_by: 'x',
    }));
    await commitFile('src/auth.ts', 'export function sign() { return 2; }', 'feat: change signing');

    await hookCommand({ cwd: tmpDir });

    const node = await readNode(join(mastishkDir, 'map', 'map-auth.msk.md'));
    expect(node.stale).toBe(true);
  });

  it('leaves map nodes for untouched paths alone', async () => {
    await initGitRepo();
    await commitNode(mastishkDir, makeMapNode('map-auth', 'src/auth.ts', 'Signs JWTs.', {
      created_by: 'x', last_updated_by: 'x',
    }));
    await commitNode(mastishkDir, makeMapNode('map-db', 'src/db.ts', 'DB client.', {
      created_by: 'x', last_updated_by: 'x',
    }));
    await commitFile('src/db.ts', 'export const c = 1;', 'feat: change db');

    await hookCommand({ cwd: tmpDir });

    expect((await readNode(join(mastishkDir, 'map', 'map-auth.msk.md'))).stale).toBe(false);
    expect((await readNode(join(mastishkDir, 'map', 'map-db.msk.md'))).stale).toBe(true);
  });

  it('flags staleness even when the commit prefix writes no state note', async () => {
    // A `chore:` refactor stales the map exactly as much as a `feat:` does.
    await initGitRepo();
    await commitNode(mastishkDir, makeMapNode('map-auth', 'src/auth.ts', 'Signs JWTs.', {
      created_by: 'x', last_updated_by: 'x',
    }));
    await commitFile('src/auth.ts', 'export function sign() { return 3; }', 'chore: reformat');

    await hookCommand({ cwd: tmpDir });

    expect((await readNode(join(mastishkDir, 'map', 'map-auth.msk.md'))).stale).toBe(true);
  });

  it('does not throw outside a git repository', async () => {
    await commitNode(mastishkDir, makeMapNode('map-auth', 'src/auth.ts', 'Signs JWTs.', {
      created_by: 'x', last_updated_by: 'x',
    }));
    await expect(hookCommand({ cwd: tmpDir })).resolves.toBeUndefined();
  });
});
