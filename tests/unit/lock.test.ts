import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireLock, MskLockError, LOCK_FILE, writeFileAtomic } from '@mastishk/core';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-lock-'));
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('acquireLock — spec section 17.2', () => {
  it('creates .lock with holder agent ID and timestamp', async () => {
    const release = await acquireLock(tmpDir, 'claude-code');
    const info = JSON.parse(await readFile(join(tmpDir, LOCK_FILE), 'utf-8'));
    expect(info.agent).toBe('claude-code');
    expect(Date.parse(info.at)).not.toBeNaN();
    await release();
  });

  it('release removes the lock file', async () => {
    const release = await acquireLock(tmpDir, 'claude-code');
    await release();
    await expect(access(join(tmpDir, LOCK_FILE))).rejects.toThrow();
  });

  it('a held lock blocks a second acquirer until timeout', async () => {
    const release = await acquireLock(tmpDir, 'agent-a');
    await expect(
      acquireLock(tmpDir, 'agent-b', { timeoutMs: 150 })
    ).rejects.toBeInstanceOf(MskLockError);
    await release();
  });

  it('the lock error names the holder', async () => {
    const release = await acquireLock(tmpDir, 'agent-a');
    try {
      await acquireLock(tmpDir, 'agent-b', { timeoutMs: 150 });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as MskLockError).holder).toBe('agent-a');
    } finally {
      await release();
    }
  });

  it('breaks a stale lock (older than staleMs)', async () => {
    const staleAt = new Date(Date.now() - 60_000).toISOString();
    await writeFile(
      join(tmpDir, LOCK_FILE),
      JSON.stringify({ agent: 'crashed-agent', at: staleAt }),
      'utf-8'
    );
    const release = await acquireLock(tmpDir, 'agent-b', { staleMs: 30_000 });
    const info = JSON.parse(await readFile(join(tmpDir, LOCK_FILE), 'utf-8'));
    expect(info.agent).toBe('agent-b');
    await release();
  });

  it('breaks a corrupt lock file', async () => {
    await writeFile(join(tmpDir, LOCK_FILE), 'not json', 'utf-8');
    const release = await acquireLock(tmpDir, 'agent-b', { timeoutMs: 500 });
    expect(release).toBeTypeOf('function');
    await release();
  });

  it('lock is released after the holder finishes (sequential writers)', async () => {
    const releaseA = await acquireLock(tmpDir, 'agent-a');
    setTimeout(() => void releaseA(), 50);
    const releaseB = await acquireLock(tmpDir, 'agent-b', { timeoutMs: 2_000 });
    const info = JSON.parse(await readFile(join(tmpDir, LOCK_FILE), 'utf-8'));
    expect(info.agent).toBe('agent-b');
    await releaseB();
  });
});

describe('writeFileAtomic — spec section 17.1', () => {
  it('writes content and leaves no temporary files behind', async () => {
    const target = join(tmpDir, 'sub', 'node.msk.md');
    await writeFileAtomic(target, 'hello');
    expect(await readFile(target, 'utf-8')).toBe('hello');
    const leftovers = (await readdir(join(tmpDir, 'sub'))).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('replaces existing content atomically', async () => {
    const target = join(tmpDir, 'node.msk.md');
    await writeFileAtomic(target, 'first');
    await writeFileAtomic(target, 'second');
    expect(await readFile(target, 'utf-8')).toBe('second');
  });
});
