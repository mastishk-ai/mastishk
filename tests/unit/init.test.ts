import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access, mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initCommand } from '../../src/packages/cli/src/commands/init.js';
import { readNode, readMemoryMap } from '@mastishk/core';

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-init-enhanced-'));
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe('init — creates all required files', () => {
  it('creates .mastishk/ with four layer dirs, memory-map.json and agents.json', async () => {
    await initCommand({ cwd: tmpDir, skipPrompt: true });
    for (const layer of ['intent', 'state', 'knowledge', 'issues']) {
      expect(await exists(join(tmpDir, '.mastishk', layer))).toBe(true);
    }
    expect(await exists(join(tmpDir, '.mastishk', 'memory-map.json'))).toBe(true);
    expect(await exists(join(tmpDir, '.mastishk', 'agents.json'))).toBe(true);
  });

  it('creates CLAUDE.md when it does not exist', async () => {
    await initCommand({ cwd: tmpDir, skipPrompt: true });
    const content = await readFile(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('## Mastishk memory');
    expect(content).toContain('mastishk inject');
  });
});

describe('init — interactive goal prompt writes nodes', () => {
  it('writes goal-main node to intent layer when answers provided', async () => {
    await initCommand({
      cwd: tmpDir,
      answers: {
        what: 'A todo app',
        goal: 'Ship v1 by July',
        targetDate: '2026-07-01',
      },
    });
    const nodePath = join(tmpDir, '.mastishk', 'intent', 'goal-main.msk.md');
    expect(await exists(nodePath)).toBe(true);
    const node = await readNode(nodePath);
    expect(node.id).toBe('goal-main');
    expect(node.type).toBe('goal');
    expect(node.layer).toBe('intent');
    expect(node.confidence).toBe(1.0);
    expect(node.body).toContain('A todo app');
    expect(node.body).toContain('Ship v1 by July');
  });

  it('writes progress-initial node to state layer', async () => {
    await initCommand({
      cwd: tmpDir,
      answers: { what: 'App', goal: 'Launch', currentStatus: 'Just started' },
    });
    const nodePath = join(tmpDir, '.mastishk', 'state', 'progress-initial.msk.md');
    expect(await exists(nodePath)).toBe(true);
    const node = await readNode(nodePath);
    expect(node.id).toBe('progress-initial');
    expect(node.type).toBe('task');
    expect(node.layer).toBe('state');
    expect(node.body).toContain('Just started');
  });

  it('writes constraints-main only when constraints provided', async () => {
    const constraintPath = join(tmpDir, '.mastishk', 'intent', 'constraints-main.msk.md');

    await initCommand({ cwd: tmpDir, answers: { what: 'App', goal: 'Launch' } });
    expect(await exists(constraintPath)).toBe(false);

    await rm(join(tmpDir, '.mastishk'), { recursive: true, force: true });

    await initCommand({
      cwd: tmpDir,
      answers: { what: 'App', goal: 'Launch', constraints: 'TypeScript only, no cloud' },
    });
    expect(await exists(constraintPath)).toBe(true);
    const node = await readNode(constraintPath);
    expect(node.type).toBe('constraint');
    expect(node.body).toContain('TypeScript only');
  });

  it('uses "Fresh project" as default progress body when currentStatus empty', async () => {
    await initCommand({ cwd: tmpDir, answers: { what: 'App', goal: 'Launch' } });
    const node = await readNode(
      join(tmpDir, '.mastishk', 'state', 'progress-initial.msk.md')
    );
    expect(node.body).toContain('Fresh project');
  });

  it('registers written nodes in memory-map.json', async () => {
    await initCommand({
      cwd: tmpDir,
      answers: { what: 'App', goal: 'Launch', constraints: 'No vendor lock-in' },
    });
    const map = await readMemoryMap(join(tmpDir, '.mastishk', 'memory-map.json'));
    expect(map.nodes['goal-main']).toBeDefined();
    expect(map.nodes['constraints-main']).toBeDefined();
    expect(map.nodes['progress-initial']).toBeDefined();
    expect(map.nodes['goal-main']!.layer).toBe('intent');
    expect(map.nodes['progress-initial']!.layer).toBe('state');
  });
});

describe('init — existing .mastishk/ skips prompt', () => {
  it('does not overwrite existing intent nodes when re-running init', async () => {
    // First init with answers
    await initCommand({
      cwd: tmpDir,
      answers: { what: 'Original', goal: 'First goal' },
    });
    const mapBefore = await readMemoryMap(join(tmpDir, '.mastishk', 'memory-map.json'));
    expect(mapBefore.nodes['goal-main']).toBeDefined();

    // Second init — intent/ is not empty, so prompt is skipped even with answers
    await initCommand({
      cwd: tmpDir,
      answers: { what: 'Override attempt', goal: 'Should not appear' },
    });
    // goal-main body should still reference the original content
    const node = await readNode(join(tmpDir, '.mastishk', 'intent', 'goal-main.msk.md'));
    expect(node.body).toContain('Original');
    expect(node.body).not.toContain('Override attempt');
  });
});

describe('init — CLAUDE.md', () => {
  it('appends section to existing CLAUDE.md without duplicating', async () => {
    await writeFile(join(tmpDir, 'CLAUDE.md'), '# My Project\n\nExisting content.\n');
    await initCommand({ cwd: tmpDir, skipPrompt: true });
    const content = await readFile(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('Existing content.');
    expect(content).toContain('## Mastishk memory');
    const count = (content.match(/## Mastishk memory/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('does not add duplicate section on second init', async () => {
    await initCommand({ cwd: tmpDir, skipPrompt: true });
    await initCommand({ cwd: tmpDir, skipPrompt: true });
    const content = await readFile(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    const count = (content.match(/## Mastishk memory/g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe('init — git hook', () => {
  it('creates post-commit hook when .git/ exists', async () => {
    // Simulate a .git/hooks directory
    await mkdir(join(tmpDir, '.git', 'hooks'), { recursive: true });
    await initCommand({ cwd: tmpDir, skipPrompt: true });
    const hookPath = join(tmpDir, '.git', 'hooks', 'post-commit');
    expect(await exists(hookPath)).toBe(true);
    const content = await readFile(hookPath, 'utf-8');
    expect(content).toContain('#!/bin/sh');
    expect(content).toContain('npx @mastishk/cli hook');
  });

  it('hook file has correct content', async () => {
    await mkdir(join(tmpDir, '.git', 'hooks'), { recursive: true });
    await initCommand({ cwd: tmpDir, skipPrompt: true });
    const hookPath = join(tmpDir, '.git', 'hooks', 'post-commit');
    const content = await readFile(hookPath, 'utf-8');
    expect(content.trim()).toBe('#!/bin/sh\nnpx @mastishk/cli hook');
  });

  it('skips hook installation silently when .git/ does not exist', async () => {
    // No .git/ directory — should not throw
    await expect(initCommand({ cwd: tmpDir, skipPrompt: true })).resolves.not.toThrow();
    expect(await exists(join(tmpDir, '.git'))).toBe(false);
  });

  it('hook file has executable permissions set (mode check)', async () => {
    await mkdir(join(tmpDir, '.git', 'hooks'), { recursive: true });
    await initCommand({ cwd: tmpDir, skipPrompt: true });
    const hookPath = join(tmpDir, '.git', 'hooks', 'post-commit');
    const s = await stat(hookPath);
    // On Windows, octal mode may not reflect unix bits — at minimum the file exists
    expect(s.isFile()).toBe(true);
    // On POSIX, verify executable bit
    if (process.platform !== 'win32') {
      // eslint-disable-next-line no-bitwise
      expect(s.mode & 0o111).toBeGreaterThan(0);
    }
  });
});
