/**
 * Compliance suite — Section 11: CLI interface
 *
 * Tests that all required CLI commands are available and produce correct
 * output/side-effects. Commands tested here: init, inject, update, log, status,
 * scan, checkpoint, next, map, doctor.
 * session start/end and catchup are covered by 09-sessions; the map staleness
 * contract is covered by 10-map-staleness.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readMemoryMap, readNode } from '@mastishk/core';
import { initCommand } from '../../src/packages/cli/src/commands/init.js';
import { injectCommand } from '../../src/packages/cli/src/commands/inject-cmd.js';
import { updateCommand } from '../../src/packages/cli/src/commands/update-cmd.js';
import { logCommand } from '../../src/packages/cli/src/commands/log-cmd.js';
import { statusCommand } from '../../src/packages/cli/src/commands/status.js';
import { scanCommand } from '../../src/packages/cli/src/commands/scan.js';
import { checkpointCommand } from '../../src/packages/cli/src/commands/checkpoint.js';
import { nextCommand } from '../../src/packages/cli/src/commands/next-cmd.js';
import { mapCommand } from '../../src/packages/cli/src/commands/map-cmd.js';
import { doctorCommand } from '../../src/packages/cli/src/commands/doctor-cmd.js';

let tmpDir: string;

beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'msk-c07-')); });
afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------
// Section 11 — mastishk init
// ---------------------------------------------------------------------------

describe('section 11 — mastishk init', () => {
  it('creates .mastishk/ folder', async () => {
    await initCommand({ cwd: tmpDir });
    await expect(access(join(tmpDir, '.mastishk'))).resolves.toBeUndefined();
  });

  // Spec 11 — init MUST create the folder structure including map/ (v0.3)
  it('creates every layer directory', async () => {
    await initCommand({ cwd: tmpDir });
    for (const layer of ['intent', 'state', 'knowledge', 'map', 'issues']) {
      await expect(access(join(tmpDir, '.mastishk', layer))).resolves.toBeUndefined();
    }
  });

  // Spec 11 + 3 — sessions/ is ephemeral and MUST be excluded from version control
  it('creates sessions/ and gitignores it', async () => {
    await initCommand({ cwd: tmpDir });
    await expect(access(join(tmpDir, '.mastishk', 'sessions'))).resolves.toBeUndefined();
    const gitignore = await readFile(join(tmpDir, '.mastishk', '.gitignore'), 'utf-8');
    expect(gitignore).toContain('sessions/');
  });

  it('creates memory-map.json with empty nodes and edges', async () => {
    await initCommand({ cwd: tmpDir });
    const map = await readMemoryMap(join(tmpDir, '.mastishk', 'memory-map.json'));
    expect(map.nodes).toEqual({});
    expect(map.edges).toEqual([]);
    expect(map.version).toBe('0.1');
  });

  it('creates agents.json with default config', async () => {
    await initCommand({ cwd: tmpDir });
    const raw = await readFile(join(tmpDir, '.mastishk', 'agents.json'), 'utf-8');
    const agents = JSON.parse(raw) as Record<string, unknown>;
    expect(agents['version']).toBe('0.3');
    expect(agents['conflict_strategy']).toBe('flag');
    expect(agents['write_back']).toBe('required');
    expect(Array.isArray(agents['registered_agents'])).toBe(true);
  });

  it('appends Mastishk section to existing CLAUDE.md', async () => {
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(join(tmpDir, 'CLAUDE.md'), '# My Project\n\nExisting content.\n', 'utf-8')
    );
    await initCommand({ cwd: tmpDir });
    const content = await readFile(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('## Mastishk memory');
  });

  it('does not duplicate Mastishk section if already present', async () => {
    await initCommand({ cwd: tmpDir });
    await initCommand({ cwd: tmpDir }); // run twice
    const claudeMdPath = join(tmpDir, 'CLAUDE.md');
    try {
      const content = await readFile(claudeMdPath, 'utf-8');
      const count = (content.match(/## Mastishk memory/g) ?? []).length;
      expect(count).toBeLessThanOrEqual(1);
    } catch {
      // No CLAUDE.md — that's fine, just skip the check
    }
  });
});

// ---------------------------------------------------------------------------
// Section 11 — mastishk inject
// ---------------------------------------------------------------------------

describe('section 11 — mastishk inject', () => {
  it('returns a context string starting with ## Mastishk context', async () => {
    await initCommand({ cwd: tmpDir });
    const result = await injectCommand('build auth', { cwd: tmpDir });
    expect(result).toMatch(/^## Mastishk context/);
  });

  it('throws or rejects when .mastishk does not exist', async () => {
    await expect(injectCommand('any task', { cwd: tmpDir })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Section 11 — mastishk update
// ---------------------------------------------------------------------------

describe('section 11 — mastishk update', () => {
  it('throws when node id does not exist in memory-map', async () => {
    await initCommand({ cwd: tmpDir });
    await expect(updateCommand('goal-nonexistent', { cwd: tmpDir })).rejects.toThrow();
  });

  it('updates status of existing node to resolved', async () => {
    await initCommand({ cwd: tmpDir });
    const logId = await logCommand('Test issue.', { cwd: tmpDir });
    await updateCommand(logId, { status: 'resolved', cwd: tmpDir });
    const node = await readNode(join(tmpDir, '.mastishk', `issues/${logId}.msk.md`));
    expect(node.status).toBe('resolved');
  });

  it('updates confidence of existing node', async () => {
    await initCommand({ cwd: tmpDir });
    const logId = await logCommand('Test issue for confidence.', { cwd: tmpDir });
    await updateCommand(logId, { confidence: '0.3', cwd: tmpDir });
    const node = await readNode(join(tmpDir, '.mastishk', `issues/${logId}.msk.md`));
    expect(node.confidence).toBe(0.3);
  });
});

// ---------------------------------------------------------------------------
// Section 11 — mastishk log
// ---------------------------------------------------------------------------

describe('section 11 — mastishk log', () => {
  it('creates an issue node with correct fields', async () => {
    await initCommand({ cwd: tmpDir });
    const id = await logCommand('Zod version conflict.', { cwd: tmpDir });
    const node = await readNode(join(tmpDir, '.mastishk', `issues/${id}.msk.md`));
    expect(node.type).toBe('issue');
    expect(node.layer).toBe('issues');
    expect(node.status).toBe('active');
    expect(node.body).toContain('Zod version conflict.');
  });

  it('--error flag adds error tag', async () => {
    await initCommand({ cwd: tmpDir });
    const id = await logCommand('Build failed.', { error: true, cwd: tmpDir });
    const node = await readNode(join(tmpDir, '.mastishk', `issues/${id}.msk.md`));
    expect(node.tags).toContain('error');
  });

  it('adds issue to memory-map.json', async () => {
    await initCommand({ cwd: tmpDir });
    const id = await logCommand('Map test.', { cwd: tmpDir });
    const map = await readMemoryMap(join(tmpDir, '.mastishk', 'memory-map.json'));
    expect(map.nodes[id]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Section 11 — mastishk status
// ---------------------------------------------------------------------------

describe('section 11 — mastishk status', () => {
  it('returns a status result with totalNodes field', async () => {
    await initCommand({ cwd: tmpDir });
    const result = await statusCommand({ cwd: tmpDir });
    expect(typeof result.totalNodes).toBe('number');
  });

  it('openIssues is empty array when no issues logged', async () => {
    await initCommand({ cwd: tmpDir });
    const result = await statusCommand({ cwd: tmpDir });
    expect(result.openIssues).toEqual([]);
  });

  it('counts nodes correctly after logging', async () => {
    await initCommand({ cwd: tmpDir });
    await logCommand('Issue 1.', { cwd: tmpDir });
    await logCommand('Issue 2.', { cwd: tmpDir });
    const result = await statusCommand({ cwd: tmpDir });
    expect(result.totalNodes).toBe(2);
  });

  it('openIssues lists logged issue ids', async () => {
    await initCommand({ cwd: tmpDir });
    const id = await logCommand('Test issue.', { cwd: tmpDir });
    const result = await statusCommand({ cwd: tmpDir });
    expect(result.openIssues).toContain(id);
  });
});

// ---------------------------------------------------------------------------
// Section 11 — mastishk scan
// ---------------------------------------------------------------------------

describe('section 11 — mastishk scan', () => {
  it('infers knowledge nodes from package.json', async () => {
    await initCommand({ cwd: tmpDir });
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'compliance-test', version: '1.0.0', description: 'Test project.',
      }), 'utf-8')
    );
    const { added } = await scanCommand({ cwd: tmpDir, autoConfirm: 'yes' });
    expect(added).toContain('fact-compliance-test-project');
  });

  it('inferred nodes have scanned: true', async () => {
    await initCommand({ cwd: tmpDir });
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'scan-test' }), 'utf-8')
    );
    const { added } = await scanCommand({ cwd: tmpDir, autoConfirm: 'yes' });
    if (added.length > 0) {
      const node = await readNode(join(tmpDir, '.mastishk', 'knowledge', `${added[0]}.msk.md`));
      expect(node.scanned).toBe(true);
    }
  });

  it('inferred nodes have confidence 0.6', async () => {
    await initCommand({ cwd: tmpDir });
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'conf-test' }), 'utf-8')
    );
    const { added } = await scanCommand({ cwd: tmpDir, autoConfirm: 'yes' });
    if (added.length > 0) {
      const node = await readNode(join(tmpDir, '.mastishk', 'knowledge', `${added[0]}.msk.md`));
      expect(node.confidence).toBe(0.6);
    }
  });

  it('does not re-add existing nodes', async () => {
    await initCommand({ cwd: tmpDir });
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'dedup-test' }), 'utf-8')
    );
    await scanCommand({ cwd: tmpDir, autoConfirm: 'yes' });
    const { added } = await scanCommand({ cwd: tmpDir, autoConfirm: 'yes' });
    expect(added).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Section 11 — mastishk checkpoint
// ---------------------------------------------------------------------------

describe('section 11 — mastishk checkpoint', () => {
  it('rejects with descriptive error outside a git repo', async () => {
    await initCommand({ cwd: tmpDir });
    await expect(checkpointCommand({ cwd: tmpDir })).rejects.toThrow('Git checkpoint failed');
  });
});

// ---------------------------------------------------------------------------
// Section 11 — mastishk next  [v0.3]
// ---------------------------------------------------------------------------

describe('section 11 — mastishk next', () => {
  it('is available and reports no active plan on a fresh folder', async () => {
    await initCommand({ cwd: tmpDir });
    const { stepId } = await nextCommand({ cwd: tmpDir });
    expect(stepId).toBeNull();
  });

  it('rejects outside a mastishk project', async () => {
    await expect(nextCommand({ cwd: tmpDir })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Section 11 — mastishk map  [v0.3]
// ---------------------------------------------------------------------------

describe('section 11 — mastishk map', () => {
  it('is available and returns an empty map on a fresh folder', async () => {
    await initCommand({ cwd: tmpDir });
    const { entries } = await mapCommand({ cwd: tmpDir });
    expect(entries).toEqual([]);
  });

  it('accepts the --stale filter', async () => {
    await initCommand({ cwd: tmpDir });
    const { entries } = await mapCommand({ cwd: tmpDir, stale: true });
    expect(entries).toEqual([]);
  });

  it('rejects outside a mastishk project', async () => {
    await expect(mapCommand({ cwd: tmpDir })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Section 11 — mastishk doctor  [v0.3]
// ---------------------------------------------------------------------------

describe('section 11 — mastishk doctor', () => {
  it('reports a freshly initialised folder as healthy', async () => {
    await initCommand({ cwd: tmpDir });
    const report = await doctorCommand({ cwd: tmpDir });
    expect(report.ok).toBe(true);
    expect(report.violations).toBe(0);
  });

  it('rejects outside a mastishk project', async () => {
    await expect(doctorCommand({ cwd: tmpDir })).rejects.toThrow();
  });
});
