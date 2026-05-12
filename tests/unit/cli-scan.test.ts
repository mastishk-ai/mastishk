import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readMemoryMap, readNode } from '@mastishk/core';
import { initCommand } from '../../src/packages/cli/src/commands/init.js';
import { scanInfer, scanCommand } from '../../src/packages/cli/src/commands/scan.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-scan-'));
  await initCommand({ cwd: tmpDir });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writePackageJson(cwd: string, pkg: Record<string, unknown>): Promise<void> {
  await writeFile(join(cwd, 'package.json'), JSON.stringify(pkg, null, 2), 'utf-8');
}

async function writeReadme(cwd: string, content: string): Promise<void> {
  await writeFile(join(cwd, 'README.md'), content, 'utf-8');
}

// ---------------------------------------------------------------------------
// scanInfer — package.json
// ---------------------------------------------------------------------------

describe('scanInfer — package.json', () => {
  it('infers project fact from package.json name', async () => {
    await writePackageJson(tmpDir, { name: 'my-app', version: '1.0.0', description: 'A great app.' });
    const candidates = await scanInfer(tmpDir);
    const project = candidates.find((c) => c.node.id === 'fact-my-app-project');
    expect(project).toBeDefined();
    expect(project!.source).toBe('package.json');
    expect(project!.node.layer).toBe('knowledge');
    expect(project!.node.type).toBe('fact');
    expect(project!.node.body).toContain('my-app');
  });

  it('strips npm scope from package name for id', async () => {
    await writePackageJson(tmpDir, { name: '@scope/my-lib', version: '0.1.0' });
    const candidates = await scanInfer(tmpDir);
    const project = candidates.find((c) => c.source === 'package.json' && c.node.id.includes('my-lib'));
    expect(project).toBeDefined();
  });

  it('infers deps fact when dependencies present', async () => {
    await writePackageJson(tmpDir, {
      name: 'my-app',
      dependencies: { zod: '^3.0.0', 'gray-matter': '^4.0.0' },
    });
    const candidates = await scanInfer(tmpDir);
    const deps = candidates.find((c) => c.node.id === 'fact-my-app-deps');
    expect(deps).toBeDefined();
    expect(deps!.node.body).toContain('zod');
  });

  it('infers devdeps fact when devDependencies present', async () => {
    await writePackageJson(tmpDir, {
      name: 'my-app',
      devDependencies: { typescript: '^5.0.0', vitest: '^1.0.0' },
    });
    const candidates = await scanInfer(tmpDir);
    const devDeps = candidates.find((c) => c.node.id === 'fact-my-app-devdeps');
    expect(devDeps).toBeDefined();
    expect(devDeps!.node.body).toContain('typescript');
  });

  it('skips gracefully when no package.json', async () => {
    const candidates = await scanInfer(tmpDir);
    const pkgCandidates = candidates.filter((c) => c.source === 'package.json');
    expect(pkgCandidates).toHaveLength(0);
  });

  it('all inferred nodes have scanned: true and confidence 0.6', async () => {
    await writePackageJson(tmpDir, { name: 'my-app', dependencies: { zod: '3' } });
    const candidates = await scanInfer(tmpDir);
    for (const c of candidates.filter((x) => x.source === 'package.json')) {
      expect(c.node.scanned).toBe(true);
      expect(c.node.confidence).toBe(0.6);
    }
  });
});

// ---------------------------------------------------------------------------
// scanInfer — README.md
// ---------------------------------------------------------------------------

describe('scanInfer — README.md', () => {
  it('infers goal from first # heading', async () => {
    await writeReadme(tmpDir, '# My Cool Project\n\nDoes something awesome.\n');
    const candidates = await scanInfer(tmpDir);
    const readme = candidates.find((c) => c.source === 'readme');
    expect(readme).toBeDefined();
    expect(readme!.node.layer).toBe('intent');
    expect(readme!.node.type).toBe('goal');
    expect(readme!.node.id).toContain('my-cool-project');
  });

  it('uses first paragraph after heading as body', async () => {
    await writeReadme(tmpDir, '# My Project\n\nThis project does X.\n\nMore text here.\n');
    const candidates = await scanInfer(tmpDir);
    const readme = candidates.find((c) => c.source === 'readme');
    expect(readme!.node.body).toBe('This project does X.');
  });

  it('skips gracefully when no README.md', async () => {
    const candidates = await scanInfer(tmpDir);
    const readmeCandidates = candidates.filter((c) => c.source === 'readme');
    expect(readmeCandidates).toHaveLength(0);
  });

  it('skips gracefully when README has no # heading', async () => {
    await writeReadme(tmpDir, 'Just some text without a heading.\n');
    const candidates = await scanInfer(tmpDir);
    const readmeCandidates = candidates.filter((c) => c.source === 'readme');
    expect(readmeCandidates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// scanCommand — integration
// ---------------------------------------------------------------------------

describe('scanCommand', () => {
  it('adds inferred nodes to memory-map.json', async () => {
    await writePackageJson(tmpDir, { name: 'test-proj', version: '1.0.0' });
    await scanCommand({ cwd: tmpDir, autoConfirm: 'yes' });

    const map = await readMemoryMap(join(tmpDir, '.mastishk', 'memory-map.json'));
    expect(map.nodes['fact-test-proj-project']).toBeDefined();
  });

  it('writes valid .msk.md file for each added node', async () => {
    await writePackageJson(tmpDir, { name: 'test-proj', version: '1.0.0' });
    await scanCommand({ cwd: tmpDir, autoConfirm: 'yes' });

    const node = await readNode(join(tmpDir, '.mastishk', 'knowledge', 'fact-test-proj-project.msk.md'));
    expect(node.id).toBe('fact-test-proj-project');
    expect(node.scanned).toBe(true);
    expect(node.layer).toBe('knowledge');
  });

  it('returns added ids', async () => {
    await writePackageJson(tmpDir, { name: 'test-proj', dependencies: { zod: '3' } });
    const { added } = await scanCommand({ cwd: tmpDir, autoConfirm: 'yes' });
    expect(added).toContain('fact-test-proj-project');
    expect(added).toContain('fact-test-proj-deps');
  });

  it('skips nodes already in memory-map', async () => {
    await writePackageJson(tmpDir, { name: 'test-proj', version: '1.0.0' });
    await scanCommand({ cwd: tmpDir, autoConfirm: 'yes' });
    // second scan — same node already exists
    const { added } = await scanCommand({ cwd: tmpDir, autoConfirm: 'yes' });
    expect(added).toHaveLength(0);
  });

  it('respects autoConfirm: no — adds nothing', async () => {
    await writePackageJson(tmpDir, { name: 'test-proj', version: '1.0.0' });
    const { added, skipped } = await scanCommand({ cwd: tmpDir, autoConfirm: 'no' });
    expect(added).toHaveLength(0);
    expect(skipped.length).toBeGreaterThan(0);
  });

  it('respects custom confirm callback', async () => {
    await writePackageJson(tmpDir, {
      name: 'test-proj',
      version: '1.0.0',
      dependencies: { zod: '3' },
    });

    // Accept only the project node, reject the deps node
    const { added, skipped } = await scanCommand({
      cwd: tmpDir,
      confirm: async (node) => (node.id.endsWith('-project') ? 'yes' : 'no'),
    });

    expect(added).toContain('fact-test-proj-project');
    expect(skipped).toContain('fact-test-proj-deps');
  });

  it('inferred nodes for README appear in intent layer folder', async () => {
    await writeReadme(tmpDir, '# Awesome Tool\n\nDoes awesome things.\n');
    await scanCommand({ cwd: tmpDir, autoConfirm: 'yes' });

    const node = await readNode(join(tmpDir, '.mastishk', 'intent', 'goal-awesome-tool-readme.msk.md'));
    expect(node.type).toBe('goal');
    expect(node.layer).toBe('intent');
  });
});
