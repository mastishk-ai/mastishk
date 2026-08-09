import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic.js';

// Spec section 9 — agents.json

export type ConflictStrategy = 'flag' | 'human' | 'latest';
export type TrustLevel = 'high' | 'medium' | 'low';
export type AccessLevel = 'read-write' | 'read-only';

export interface RegisteredAgent {
  id: string;
  access: AccessLevel;
  trust: TrustLevel;
  last_session_at?: string | null;
}

export interface AgentsConfig {
  version: string;
  conflict_strategy: ConflictStrategy;
  write_back: string;
  session_timeout_hours?: number;
  registered_agents: RegisteredAgent[];
}

export const AGENTS_FILE = 'agents.json';

export function createDefaultAgentsConfig(): AgentsConfig {
  return {
    version: '0.3',
    conflict_strategy: 'flag',
    write_back: 'required',
    session_timeout_hours: 8,
    registered_agents: [
      { id: 'claude-code', access: 'read-write', trust: 'high', last_session_at: null },
      { id: 'cursor', access: 'read-write', trust: 'high', last_session_at: null },
    ],
  };
}

/** Returns null if agents.json does not exist or cannot be parsed. */
export async function readAgentsConfig(mastishkDir: string): Promise<AgentsConfig | null> {
  try {
    const raw = await readFile(join(mastishkDir, AGENTS_FILE), 'utf-8');
    return JSON.parse(raw) as AgentsConfig;
  } catch {
    return null;
  }
}

export async function writeAgentsConfig(
  mastishkDir: string,
  config: AgentsConfig
): Promise<void> {
  await writeFileAtomic(
    join(mastishkDir, AGENTS_FILE),
    JSON.stringify(config, null, 2) + '\n'
  );
}

/**
 * Spec section 9 — implementations SHOULD auto-register unknown writing agents
 * with trust "medium". Returns the (possibly extended) config and the agent entry.
 * Mutates nothing; callers persist the returned config if `registered` is true.
 */
export function ensureRegistered(
  config: AgentsConfig,
  agentId: string
): { config: AgentsConfig; agent: RegisteredAgent; registered: boolean } {
  const existing = config.registered_agents.find((a) => a.id === agentId);
  if (existing) return { config, agent: existing, registered: false };

  const agent: RegisteredAgent = {
    id: agentId,
    access: 'read-write',
    trust: 'medium',
    last_session_at: null,
  };
  return {
    config: { ...config, registered_agents: [...config.registered_agents, agent] },
    agent,
    registered: true,
  };
}
