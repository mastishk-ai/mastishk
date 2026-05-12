import { readMemoryMap } from '@mastishk/core';
import { mastishkDir, memoryMapPath, assertMastishkExists } from '../utils.js';

export interface StatusOptions {
  cwd?: string;
}

export interface StatusResult {
  totalNodes: number;
  byLayer: Record<string, number>;
  byStatus: Record<string, number>;
  openIssues: string[];
  staleNodes: string[];
  lastUpdated: string;
}

export async function statusCommand(options: StatusOptions = {}): Promise<StatusResult> {
  const cwd = options.cwd ?? process.cwd();
  await assertMastishkExists(cwd);

  const map = await readMemoryMap(memoryMapPath(cwd));
  const nodes = Object.entries(map.nodes);
  const now = Date.now();

  const byLayer: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const openIssues: string[] = [];
  const staleNodes: string[] = [];

  for (const [id, node] of nodes) {
    byLayer[node.layer] = (byLayer[node.layer] ?? 0) + 1;
    byStatus[node.status] = (byStatus[node.status] ?? 0) + 1;

    if (node.layer === 'issues' && node.status === 'active') {
      openIssues.push(id);
    }

    // Spec section 4.4: unresolved issues with expires_at in the past MUST be surfaced.
    // SPEC-GAP: spec doesn't define stale tracking for non-issue nodes, but we report all.
    if ((node as { expires_at?: string }).expires_at) {
      const expiresAt = (node as { expires_at?: string }).expires_at!;
      if (new Date(expiresAt).getTime() < now && node.status !== 'resolved') {
        staleNodes.push(id);
      }
    }
  }

  const result: StatusResult = {
    totalNodes: nodes.length,
    byLayer,
    byStatus,
    openIssues,
    staleNodes,
    lastUpdated: map.updated_at,
  };

  // Print formatted output
  const lines: string[] = [
    'Mastishk memory health',
    '======================',
    `Location: ${mastishkDir(cwd)}`,
    `Last updated: ${map.updated_at}`,
    '',
    `Nodes: ${result.totalNodes} total`,
  ];

  for (const [layer, count] of Object.entries(byLayer)) {
    lines.push(`  ${layer.padEnd(12)}: ${count}`);
  }

  lines.push('');
  lines.push('Status distribution:');
  for (const [status, count] of Object.entries(byStatus)) {
    lines.push(`  ${status.padEnd(12)}: ${count}`);
  }

  if (openIssues.length > 0) {
    lines.push('');
    lines.push(`Open issues: ${openIssues.length}`);
    for (const id of openIssues) {
      lines.push(`  - ${id}`);
    }
  } else {
    lines.push('');
    lines.push('Open issues: none');
  }

  if (staleNodes.length > 0) {
    lines.push('');
    lines.push(`Stale nodes (expires_at in the past): ${staleNodes.length}`);
    for (const id of staleNodes) {
      lines.push(`  - ${id}`);
    }
  }

  console.log(lines.join('\n'));
  return result;
}
