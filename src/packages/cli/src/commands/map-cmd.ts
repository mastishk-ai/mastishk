import { readMapEntries, refreshMapNode } from '@mastishk/core';
import type { MapEntry } from '@mastishk/core';
import { mastishkDir, assertMastishkExists } from '../utils.js';

// Spec section 11 — mastishk map [--stale] [--refresh <id>]

export interface MapCommandOptions {
  /** Show only entries flagged stale (spec 4.4). */
  stale?: boolean;
  /** Clear the stale flag on this node after the agent has verified it. */
  refresh?: string;
  cwd?: string;
}

export interface MapCommandResult {
  entries: MapEntry[];
  refreshed?: string;
}

function firstSentence(body: string): string {
  const match = body.match(/^[^.!?\n]+[.!?]?/m);
  return (match?.[0] ?? body).trim();
}

export async function mapCommand(
  options: MapCommandOptions = {}
): Promise<MapCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  await assertMastishkExists(cwd);
  const dir = mastishkDir(cwd);

  if (options.refresh) {
    const ok = await refreshMapNode(dir, options.refresh);
    if (!ok) {
      throw new Error(`No map node with id "${options.refresh}".`);
    }
    console.log(`Refreshed ${options.refresh} — stale flag cleared.`);
    return { entries: await readMapEntries(dir), refreshed: options.refresh };
  }

  const all = await readMapEntries(dir);
  const entries = options.stale ? all.filter((e) => e.stale) : all;

  if (entries.length === 0) {
    console.log(
      options.stale
        ? 'No stale map entries.'
        : 'No codebase map yet. Run "mastishk scan" to generate one.'
    );
    return { entries };
  }

  const staleCount = all.filter((e) => e.stale).length;
  console.log(`## Codebase map — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`);
  console.log('');
  for (const entry of entries) {
    // Spec 4.4 — stale entries MUST be visibly marked in all output.
    const marker = entry.stale ? ' (stale)' : '';
    console.log(`${entry.path}${marker}`);
    console.log(`  ${entry.id} [${entry.confidence.toFixed(1)}] — ${firstSentence(entry.body)}`);
  }

  if (!options.stale && staleCount > 0) {
    console.log('');
    console.log(
      `⚠ ${staleCount} entr${staleCount === 1 ? 'y is' : 'ies are'} stale — verify, then "mastishk map --refresh <id>".`
    );
  }

  return { entries };
}
