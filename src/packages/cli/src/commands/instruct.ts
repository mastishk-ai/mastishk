// The instruct interface is specified in v0.3 section 12. Onboarding-file rules
// are section 14.
import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { inject, readNode, readMemoryMap } from '@mastishk/core';
import { mastishkDir, memoryMapPath, assertMastishkExists } from '../utils.js';
import { injectAllBriefings } from './onboarding.js';

export type AgentName = 'claude-code' | 'cursor' | 'windsurf' | 'api';

export interface InstructOptions {
  cwd?: string;
  agent: AgentName;
}

// MCP server config written for Cursor and Windsurf
const MCP_SERVER_CONFIG = {
  mcpServers: {
    mastishk: {
      command: 'npx',
      args: ['@mastishk/mcp', '--memory-dir', '.mastishk'],
    },
  },
};

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface MemorySummary {
  goals: string;
  status: string;
  issueCount: number;
  lastUpdatedBy: string;
  lastUpdatedAt: string;
}

async function getMemorySummary(cwd: string): Promise<MemorySummary> {
  const dir = mastishkDir(cwd);
  const map = await readMemoryMap(memoryMapPath(cwd));

  // Find first goal node in intent layer
  let goals = 'N/A';
  const goalEntry = Object.entries(map.nodes).find(
    ([, n]) => n.layer === 'intent' && n.type === 'goal'
  );
  if (goalEntry) {
    try {
      const node = await readNode(join(dir, goalEntry[1].file));
      goals = node.body.split('\n')[0] ?? 'N/A';
    } catch {
      // file missing — skip
    }
  }

  // Find first task node in state layer for status + last-updated
  let status = 'N/A';
  let lastUpdatedBy = 'unknown';
  let lastUpdatedAt = 'unknown';
  const stateEntry = Object.entries(map.nodes).find(
    ([, n]) => n.layer === 'state' && n.type === 'task'
  );
  if (stateEntry) {
    try {
      const node = await readNode(join(dir, stateEntry[1].file));
      // Body is wrapped in append headers — get last non-header non-empty line
      const lines = node.body.split('\n').filter((l) => l.trim() && !l.startsWith('###'));
      status = lines[0] ?? 'N/A';
      lastUpdatedBy = node.last_updated_by;
      lastUpdatedAt = relativeTime(node.last_updated_at);
    } catch {
      // file missing — skip
    }
  }

  // Count active issues
  let issueCount = 0;
  try {
    const issuesDir = join(dir, 'issues');
    const files = await readdir(issuesDir);
    for (const f of files) {
      if (!f.endsWith('.msk.md')) continue;
      try {
        const node = await readNode(join(issuesDir, f));
        if (node.status === 'active') issueCount++;
      } catch {
        // skip unreadable
      }
    }
  } catch {
    // issues dir missing — 0
  }

  return { goals, status, issueCount, lastUpdatedBy, lastUpdatedAt };
}

function printMemorySummary(summary: MemorySummary): void {
  console.log(`
  Memory summary for this project:
  ─────────────────────────────────
  Goals:    ${summary.goals}
  Status:   ${summary.status}
  Issues:   ${summary.issueCount}
  Last updated by: ${summary.lastUpdatedBy} (${summary.lastUpdatedAt})
  ─────────────────────────────────
  This agent now has the same memory as every other agent on this project.`);
}

// Spec section 14.2 — unlike init, instruct MAY replace an existing Mastishk
// section with the current canonical format. That is the point of re-running it:
// an older briefing (say, one that still tells agents to run `mastishk inject`
// instead of `session start`) gets brought up to date.
async function handleClaudeCode(cwd: string): Promise<void> {
  const results = await injectAllBriefings(cwd, { replace: true });

  for (const { file, outcome } of results) {
    if (outcome === 'created') console.log(`✅ Created ${file} with the Mastishk briefing.`);
    else if (outcome === 'appended') console.log(`✅ Added the Mastishk briefing to ${file}.`);
    else if (outcome === 'replaced') console.log(`✅ Refreshed the Mastishk briefing in ${file}.`);
  }
  console.log('Open Claude Code — it has full memory.');
}

async function handleMcpAgent(
  cwd: string,
  agentDir: string,
  configFile: string,
  agentLabel: string
): Promise<void> {
  const dir = join(cwd, agentDir);
  await mkdir(dir, { recursive: true });
  const configPath = join(dir, configFile);
  await writeFile(configPath, JSON.stringify(MCP_SERVER_CONFIG, null, 2) + '\n', 'utf-8');
  console.log(
    `✅ Written to ${agentDir}/${configFile}. Restart ${agentLabel} — it will connect automatically.`
  );
}

async function handleApi(cwd: string): Promise<void> {
  const dir = mastishkDir(cwd);
  const output = await inject('current task', dir);
  console.log(output);
  console.log('\nPipe this into your agent: npx @mastishk/cli inject <task>');
}

export async function instructCommand(options: InstructOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  await assertMastishkExists(cwd);

  switch (options.agent) {
    case 'claude-code':
      await handleClaudeCode(cwd);
      break;
    case 'cursor':
      await handleMcpAgent(cwd, '.cursor', 'mcp.json', 'Cursor');
      break;
    case 'windsurf':
      await handleMcpAgent(cwd, '.windsurf', 'mcp.json', 'Windsurf');
      break;
    case 'api':
      await handleApi(cwd);
      break;
    default: {
      const exhaustive: never = options.agent;
      throw new Error(`Unknown agent: ${String(exhaustive)}`);
    }
  }

  const summary = await getMemorySummary(cwd);
  printMemorySummary(summary);
}
