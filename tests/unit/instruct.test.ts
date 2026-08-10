import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initCommand } from '../../src/packages/cli/src/commands/init.js';
import { instructCommand } from '../../src/packages/cli/src/commands/instruct.js';

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-instruct-'));
  // Seed with init so .mastishk/ exists
  await initCommand({
    cwd: tmpDir,
    answers: { what: 'Test app', goal: 'Ship it', constraints: 'No cloud' },
  });
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

describe('instruct — cursor agent', () => {
  it('writes .cursor/mcp.json with correct structure', async () => {
    await instructCommand({ cwd: tmpDir, agent: 'cursor' });
    const configPath = join(tmpDir, '.cursor', 'mcp.json');
    expect(await exists(configPath)).toBe(true);
    const raw = await readFile(configPath, 'utf-8');
    const config = JSON.parse(raw) as {
      mcpServers: {
        mastishk: { command: string; args: string[] };
      };
    };
    expect(config.mcpServers).toBeDefined();
    expect(config.mcpServers.mastishk).toBeDefined();
    expect(config.mcpServers.mastishk.command).toBe('npx');
    expect(config.mcpServers.mastishk.args).toContain('@mastishk/mcp');
    expect(config.mcpServers.mastishk.args).toContain('--memory-dir');
    expect(config.mcpServers.mastishk.args).toContain('.mastishk');
  });

  it('overwrites existing .cursor/mcp.json on second call', async () => {
    await instructCommand({ cwd: tmpDir, agent: 'cursor' });
    await instructCommand({ cwd: tmpDir, agent: 'cursor' });
    const raw = await readFile(join(tmpDir, '.cursor', 'mcp.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.mcpServers.mastishk).toBeDefined();
  });
});

describe('instruct — windsurf agent', () => {
  it('writes .windsurf/mcp.json with correct structure', async () => {
    await instructCommand({ cwd: tmpDir, agent: 'windsurf' });
    const configPath = join(tmpDir, '.windsurf', 'mcp.json');
    expect(await exists(configPath)).toBe(true);
    const raw = await readFile(configPath, 'utf-8');
    const config = JSON.parse(raw) as {
      mcpServers: {
        mastishk: { command: string; args: string[] };
      };
    };
    expect(config.mcpServers.mastishk.command).toBe('npx');
    expect(config.mcpServers.mastishk.args).toContain('@mastishk/mcp');
    expect(config.mcpServers.mastishk.args).toContain('--memory-dir');
  });

  it('windsurf and cursor configs are structurally identical', async () => {
    await instructCommand({ cwd: tmpDir, agent: 'cursor' });
    await instructCommand({ cwd: tmpDir, agent: 'windsurf' });
    const cursorRaw = await readFile(join(tmpDir, '.cursor', 'mcp.json'), 'utf-8');
    const windsurfRaw = await readFile(join(tmpDir, '.windsurf', 'mcp.json'), 'utf-8');
    expect(JSON.parse(cursorRaw)).toEqual(JSON.parse(windsurfRaw));
  });
});

describe('instruct — claude-code agent', () => {
  it('creates or updates CLAUDE.md with Mastishk section', async () => {
    await instructCommand({ cwd: tmpDir, agent: 'claude-code' });
    const content = await readFile(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('## Mastishk memory');
    expect(content).toContain('mastishk session start');
  });

  it('does not duplicate Mastishk section on second call', async () => {
    await instructCommand({ cwd: tmpDir, agent: 'claude-code' });
    await instructCommand({ cwd: tmpDir, agent: 'claude-code' });
    const content = await readFile(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    const count = (content.match(/## Mastishk memory/g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe('instruct — api agent', () => {
  it('prints inject output to stdout', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    try {
      await instructCommand({ cwd: tmpDir, agent: 'api' });
    } finally {
      console.log = origLog;
    }
    const combined = logs.join('\n');
    // Inject output starts with "## Mastishk context"
    expect(combined).toContain('## Mastishk context');
    // Usage hint
    expect(combined).toContain('npx @mastishk/cli inject');
  });
});

describe('instruct — memory summary', () => {
  it('prints memory summary block after any agent action', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    try {
      await instructCommand({ cwd: tmpDir, agent: 'cursor' });
    } finally {
      console.log = origLog;
    }
    const combined = logs.join('\n');
    expect(combined).toContain('Memory summary for this project:');
    expect(combined).toContain('Goals:');
    expect(combined).toContain('Status:');
    expect(combined).toContain('Issues:');
    expect(combined).toContain('This agent now has the same memory');
  });

  it('Goals line shows first line of goal-main body', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    try {
      await instructCommand({ cwd: tmpDir, agent: 'cursor' });
    } finally {
      console.log = origLog;
    }
    const combined = logs.join('\n');
    // 'Test app' is the first line of the goal body
    expect(combined).toContain('Test app');
  });
});
