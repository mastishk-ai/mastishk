import { join } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { writeFileAtomic } from './atomic.js';
import {
  readAgentsConfig,
  writeAgentsConfig,
  ensureRegistered,
  createDefaultAgentsConfig,
} from './agents.js';
import { readMemoryMap, writeMemoryMap, upsertNode } from './graph.js';
import { updateNodeMeta } from './write.js';
import { commitNode } from './commit.js';
import { catchup } from './catchup.js';
import { inject } from './inject.js';
import type { MskNode } from './schema.js';

// Spec section 15 — the session protocol: check in → catch up → work → hand off.

export const SESSIONS_DIR = 'sessions';
const REGISTRY_FILE = 'active.json';
const DEFAULT_TIMEOUT_HOURS = 8;

export interface ActiveSession {
  agent: string;
  task: string;
  started_at: string;
}

interface SessionRegistry {
  version: string;
  sessions: ActiveSession[];
}

function registryPath(mastishkDir: string): string {
  return join(mastishkDir, SESSIONS_DIR, REGISTRY_FILE);
}

async function readRegistry(mastishkDir: string): Promise<SessionRegistry> {
  try {
    const raw = await readFile(registryPath(mastishkDir), 'utf-8');
    return JSON.parse(raw) as SessionRegistry;
  } catch {
    return { version: '0.3', sessions: [] };
  }
}

async function writeRegistry(mastishkDir: string, registry: SessionRegistry): Promise<void> {
  await writeFileAtomic(registryPath(mastishkDir), JSON.stringify(registry, null, 2) + '\n');
}

// Spec section 15.3 — sessions older than session_timeout_hours are expired
// silently; crashed agents never block anyone.
function pruneExpired(registry: SessionRegistry, timeoutHours: number, now = Date.now()): SessionRegistry {
  const cutoff = now - timeoutHours * 60 * 60 * 1000;
  return {
    ...registry,
    sessions: registry.sessions.filter((s) => Date.parse(s.started_at) >= cutoff),
  };
}

// Spec section 3 — sessions/ is ephemeral and MUST be excluded from version control.
async function ensureSessionsGitignore(mastishkDir: string): Promise<void> {
  const gitignorePath = join(mastishkDir, '.gitignore');
  try {
    await access(gitignorePath);
  } catch {
    await writeFileAtomic(gitignorePath, 'sessions/\n.lock\n');
  }
}

async function sessionTimeoutHours(mastishkDir: string): Promise<number> {
  const config = await readAgentsConfig(mastishkDir);
  return config?.session_timeout_hours ?? DEFAULT_TIMEOUT_HOURS;
}

/** Pruned view of the active session registry (does not persist the prune). */
export async function readActiveSessions(mastishkDir: string): Promise<ActiveSession[]> {
  const timeout = await sessionTimeoutHours(mastishkDir);
  return pruneExpired(await readRegistry(mastishkDir), timeout).sessions;
}

export interface SessionStartResult {
  /** Other agents' unexpired sessions — the presence warning (spec 15.1 step 2). */
  presence: ActiveSession[];
  /** What changed since this agent's last session (spec 15.4). */
  catchup: string;
  /** Inject output for the given task (spec 6). */
  context: string;
}

// Spec section 15.1 — session start is a read operation plus presence registration.
export async function sessionStart(
  mastishkDir: string,
  agent: string,
  task: string
): Promise<SessionStartResult> {
  await ensureSessionsGitignore(mastishkDir);

  const timeout = await sessionTimeoutHours(mastishkDir);
  const registry = pruneExpired(await readRegistry(mastishkDir), timeout);
  const presence = registry.sessions.filter((s) => s.agent !== agent);

  // Re-registering replaces this agent's previous session entry.
  registry.sessions = [
    ...registry.sessions.filter((s) => s.agent !== agent),
    { agent, task, started_at: new Date().toISOString() },
  ];
  await writeRegistry(mastishkDir, registry);

  const catchupText = await catchup(mastishkDir, agent);
  const context = await inject(task, mastishkDir);

  return { presence, catchup: catchupText, context };
}

export interface SessionEndOptions {
  /** The handoff body. SHOULD cover: Done / In flight / Watch out / Next (spec 4.2). */
  handoff?: string;
}

export interface SessionEndResult {
  /** ID of the handoff node written to state/, when one was. */
  handoffId?: string;
  /** Set when no handoff was written or the handoff write was rejected. */
  warning?: string;
}

// SPEC-GAP: the spec does not say what happens to the previous handoff when a new
// one is written. We resolve prior active handoffs so "the most recent active
// handoff" (spec 6.3/15.4) is always exactly one node.
async function resolvePriorHandoffs(mastishkDir: string, agent: string): Promise<void> {
  const mapPath = join(mastishkDir, 'memory-map.json');
  let map = await readMemoryMap(mapPath);
  let changed = false;
  for (const [id, entry] of Object.entries(map.nodes)) {
    if (entry.type !== 'handoff' || entry.status !== 'active') continue;
    await updateNodeMeta(join(mastishkDir, entry.file), {
      status: 'resolved',
      last_updated_by: agent,
    });
    map = upsertNode(map, id, { ...entry, status: 'resolved' });
    changed = true;
  }
  if (changed) await writeMemoryMap(mapPath, map, { agent });
}

// Spec section 15.2 — session end: handoff, last_session_at, deregister.
// (Step 4, checkpoint, is performed by the caller — it requires git.)
export async function sessionEnd(
  mastishkDir: string,
  agent: string,
  options: SessionEndOptions = {}
): Promise<SessionEndResult> {
  const result: SessionEndResult = {};

  // 1. Handoff node
  if (options.handoff && options.handoff.trim().length > 0) {
    await resolvePriorHandoffs(mastishkDir, agent);
    const now = new Date();
    const node: MskNode = {
      id: `handoff-${now.getTime()}`,
      type: 'handoff',
      layer: 'state',
      status: 'active',
      confidence: 1.0,
      created_by: agent,
      created_at: now.toISOString(),
      last_updated_by: agent,
      last_updated_at: now.toISOString(),
      dependencies: [],
      contradictions: [],
      tags: ['handoff'],
      body: options.handoff.trim(),
    };
    const commit = await commitNode(mastishkDir, node);
    if (commit.committed) {
      result.handoffId = commit.node?.id;
    } else {
      result.warning = `Handoff write rejected: ${commit.reason ?? 'unknown reason'}`;
    }
  } else {
    result.warning =
      'No handoff written. The next session starts without your context — pass --handoff or answer the prompt.';
  }

  // 2. last_session_at in agents.json
  const config = (await readAgentsConfig(mastishkDir)) ?? createDefaultAgentsConfig();
  const { config: registered } = ensureRegistered(config, agent);
  await writeAgentsConfig(mastishkDir, {
    ...registered,
    registered_agents: registered.registered_agents.map((a) =>
      a.id === agent ? { ...a, last_session_at: new Date().toISOString() } : a
    ),
  });

  // 3. Deregister
  const timeout = await sessionTimeoutHours(mastishkDir);
  const registry = pruneExpired(await readRegistry(mastishkDir), timeout);
  registry.sessions = registry.sessions.filter((s) => s.agent !== agent);
  await writeRegistry(mastishkDir, registry);

  return result;
}
