import { open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

// Spec section 17.2 — updates to memory-map.json MUST be guarded by a lock file
// at .mastishk/.lock containing the holder's agent ID and timestamp.
// A lock older than the stale threshold (default 30s) MAY be broken.

export const LOCK_FILE = '.lock';
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 25;

export class MskLockError extends Error {
  readonly lockPath: string;
  readonly holder: string | null;

  constructor(lockPath: string, holder: string | null) {
    super(
      `Could not acquire memory lock at "${lockPath}"${holder ? ` (held by "${holder}")` : ''}`
    );
    this.name = 'MskLockError';
    this.lockPath = lockPath;
    this.holder = holder;
  }
}

export interface LockOptions {
  /** How long to keep retrying before throwing MskLockError. */
  timeoutMs?: number;
  /** Locks older than this are considered stale and broken. */
  staleMs?: number;
}

interface LockInfo {
  agent: string;
  at: string;
}

async function readLockInfo(lockPath: string): Promise<LockInfo | null> {
  try {
    return JSON.parse(await readFile(lockPath, 'utf-8')) as LockInfo;
  } catch {
    return null;
  }
}

/**
 * Acquire the memory folder lock. Returns a release function.
 * Acquisition is atomic via exclusive file creation (open with 'wx').
 */
export async function acquireLock(
  mastishkDir: string,
  agentId: string,
  options: LockOptions = {}
): Promise<() => Promise<void>> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, staleMs = DEFAULT_STALE_MS } = options;
  const lockPath = join(mastishkDir, LOCK_FILE);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(
        JSON.stringify({ agent: agentId, at: new Date().toISOString() }),
        'utf-8'
      );
      await handle.close();
      return async () => {
        await unlink(lockPath).catch(() => {});
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

      const info = await readLockInfo(lockPath);
      const heldAt = info ? Date.parse(info.at) : NaN;
      // Spec 17.2: a lock older than staleMs MAY be broken. An unreadable/corrupt
      // lock is also treated as breakable — it cannot belong to a healthy writer.
      if (!info || Number.isNaN(heldAt) || Date.now() - heldAt > staleMs) {
        await unlink(lockPath).catch(() => {});
        continue;
      }
      if (Date.now() >= deadline) {
        throw new MskLockError(lockPath, info.agent ?? null);
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}
