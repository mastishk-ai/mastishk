import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initCommand } from '../../src/packages/cli/src/commands/init.js';

let tmpDir: string;
beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'msk-init-')); });
afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

describe('init — folder structure', () => {
  it('creates .mastishk/ with all four layer directories', async () => {
    await initCommand({ cwd: tmpDir });
    for (const layer of ['intent', 'state', 'knowledge', 'issues']) {
      expect(await exists(join(tmpDir, '.mastishk', layer))).toBe(true);
    }
  });
});

describe('init — memory-map.json (spec section 10)', () => {
  it('creates memory-map.json with empty nodes and edges', async () => {
    await initCommand({ cwd: tmpDir });
    const raw = await readFile(join(tmpDir, '.mastishk', 'memory-map.json'), 'utf-8');
    const map = JSON.parse(raw);
    expect(map.version).toBe('0.1');
    expect(map.nodes).toEqual({});
    expect(map.edges).toEqual([]);
  });
});

describe('init — agents.json (spec section 8)', () => {
  it('creates agents.json with default config', async () => {
    await initCommand({ cwd: tmpDir });
    const raw = await readFile(join(tmpDir, '.mastishk', 'agents.json'), 'utf-8');
    const agents = JSON.parse(raw);
    expect(agents.version).toBe('0.3');
    expect(agents.conflict_strategy).toBe('flag');
    expect(agents.write_back).toBe('required');
    expect(Array.isArray(agents.registered_agents)).toBe(true);
    expect(agents.registered_agents.some((a: { id: string }) => a.id === 'claude-code')).toBe(true);
  });
});

describe('init — CLAUDE.md append (spec section 10)', () => {
  it('appends Mastishk section to CLAUDE.md if it exists', async () => {
    await writeFile(join(tmpDir, 'CLAUDE.md'), '# My Project\n\nExisting content.\n', 'utf-8');
    await initCommand({ cwd: tmpDir });
    const content = await readFile(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('Existing content.');
    expect(content).toContain('## Mastishk memory');
    expect(content).toContain('mastishk inject');
  });

  it('creates CLAUDE.md with Mastishk section when file does not exist', async () => {
    await initCommand({ cwd: tmpDir });
    // New behaviour: init creates CLAUDE.md even if absent (SPEC-GAP section 13)
    const content = await readFile(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('## Mastishk memory');
    expect(content).toContain('mastishk inject');
  });

  it('does not append duplicate section on second init', async () => {
    await writeFile(join(tmpDir, 'CLAUDE.md'), '# Project\n', 'utf-8');
    await initCommand({ cwd: tmpDir });
    await initCommand({ cwd: tmpDir }); // second init
    const content = await readFile(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    const count = (content.match(/## Mastishk memory/g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe('init — idempotency', () => {
  it('running init twice does not throw', async () => {
    await initCommand({ cwd: tmpDir });
    await expect(initCommand({ cwd: tmpDir })).resolves.not.toThrow();
  });

  it('second init does not corrupt memory-map.json', async () => {
    await initCommand({ cwd: tmpDir });
    await initCommand({ cwd: tmpDir });
    const raw = await readFile(join(tmpDir, '.mastishk', 'memory-map.json'), 'utf-8');
    const map = JSON.parse(raw);
    expect(map.version).toBe('0.1');
  });
});
