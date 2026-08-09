import { join, relative } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { readNode } from './read.js';
import { readMemoryMap, validateGraph } from './graph.js';
import { readActiveSessions } from './session.js';
import { readAgentsConfig } from './agents.js';
import { validate } from './validate.js';

// Spec section 11 — `mastishk doctor` validates the entire memory folder and
// exits non-zero if any MUST-level violation is found.
//
// Severity split: `violation` is a MUST-level breach of the spec (bad schema,
// broken graph, duplicate IDs, missing files) and fails the exit code.
// `warning` is something an agent should see but that does not make the folder
// non-compliant (stale map entries, expired issues, stale sessions).

export type FindingSeverity = 'violation' | 'warning';

export interface DoctorFinding {
  severity: FindingSeverity;
  /** Short machine-readable category, e.g. 'schema', 'graph', 'stale-map'. */
  category: string;
  /** What is wrong and what to do about it. */
  message: string;
  /** Node ID or file path the finding concerns, when applicable. */
  subject?: string;
}

export interface DoctorReport {
  findings: DoctorFinding[];
  violations: number;
  warnings: number;
  /** True when there are no MUST-level violations. */
  ok: boolean;
  /** How many nodes were inspected. */
  nodesChecked: number;
}

const LAYER_DIRS = ['intent', 'state', 'knowledge', 'map', 'issues'] as const;

async function listNodeFiles(mastishkDir: string): Promise<string[]> {
  const found: string[] = [];
  for (const layer of LAYER_DIRS) {
    try {
      const files = await readdir(join(mastishkDir, layer));
      for (const f of files) {
        if (f.endsWith('.msk.md')) found.push(join(mastishkDir, layer, f));
      }
    } catch {
      // A missing layer directory is not itself a violation — init creates them,
      // but a hand-made folder without issues/ is still readable.
    }
  }
  return found;
}

export async function doctor(mastishkDir: string): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  const add = (
    severity: FindingSeverity,
    category: string,
    message: string,
    subject?: string
  ): void => {
    findings.push({ severity, category, message, ...(subject ? { subject } : {}) });
  };

  // --- 1. Every node file parses and validates (spec 3) ---
  const files = await listNodeFiles(mastishkDir);
  const idToFiles = new Map<string, string[]>();
  let nodesChecked = 0;

  for (const file of files) {
    const rel = relative(mastishkDir, file).replace(/\\/g, '/');
    try {
      const node = await readNode(file);
      nodesChecked++;
      idToFiles.set(node.id, [...(idToFiles.get(node.id) ?? []), rel]);

      // Spec 4.5 — an unresolved issue past its expires_at must be surfaced
      if (node.expires_at && node.status !== 'resolved') {
        if (Date.parse(node.expires_at) < Date.now()) {
          add(
            'warning',
            'expired',
            `expired ${node.expires_at} and is still ${node.status} — resolve it or extend expires_at`,
            node.id
          );
        }
      }

      // Spec 4.4 — stale map entries must be visibly marked everywhere
      if (node.layer === 'map' && node.stale === true) {
        add(
          'warning',
          'stale-map',
          `map entry for "${node.path ?? '?'}" is stale — verify it, then clear with "mastishk map --refresh ${node.id}"`,
          node.id
        );
      }
    } catch (err) {
      // Distinguish "not valid YAML/markdown at all" from "valid but fails schema"
      // so the message tells the user which fix applies.
      let detail = err instanceof Error ? err.message : String(err);
      try {
        const raw = await readFile(file, 'utf-8');
        const parsed = matter(raw);
        const result = validate({ ...parsed.data, body: parsed.content.trim() });
        if (!result.valid) detail = result.errors.join('; ');
      } catch {
        // fall through with the original message
      }
      add('violation', 'schema', `does not validate: ${detail}`, rel);
    }
  }

  // Spec 3.1 — IDs must be unique within the project
  for (const [id, owners] of idToFiles) {
    if (owners.length > 1) {
      add('violation', 'duplicate-id', `id "${id}" is used by ${owners.join(' and ')}`, id);
    }
  }

  // --- 2. The graph index (spec 5) ---
  try {
    const map = await readMemoryMap(join(mastishkDir, 'memory-map.json'));

    const graph = validateGraph(map);
    for (const error of graph.errors) {
      add('violation', 'graph', error);
    }

    for (const [id, entry] of Object.entries(map.nodes)) {
      // Index entries must point at files that exist and carry the right ID
      const owners = idToFiles.get(id);
      if (!owners) {
        add(
          'violation',
          'missing-file',
          `memory-map.json indexes "${id}" at ${entry.file}, but no node file with that id was found`,
          id
        );
        continue;
      }
      if (!owners.includes(entry.file.replace(/\\/g, '/'))) {
        add(
          'violation',
          'index-drift',
          `memory-map.json points "${id}" at ${entry.file}, but it lives at ${owners.join(', ')}`,
          id
        );
      }
      // Spec 4.4 — a map node without a path cannot participate in staleness
      if (entry.layer === 'map' && !entry.path) {
        add(
          'warning',
          'unindexed-path',
          'map node has no path in memory-map.json — ambient capture cannot flag it stale; rewrite it to reindex',
          id
        );
      }
    }

    // Nodes on disk that the index has never heard of are invisible to inject
    for (const [id, owners] of idToFiles) {
      if (!map.nodes[id]) {
        add(
          'warning',
          'unindexed-node',
          `exists at ${owners.join(', ')} but is not in memory-map.json — inject will never surface it`,
          id
        );
      }
    }
  } catch (err) {
    add(
      'violation',
      'graph',
      `memory-map.json cannot be read: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // --- 3. Sessions (spec 15.3) ---
  try {
    const config = await readAgentsConfig(mastishkDir);
    const timeoutHours = config?.session_timeout_hours ?? 8;
    const active = await readActiveSessions(mastishkDir);
    for (const session of active) {
      const ageHours = (Date.now() - Date.parse(session.started_at)) / 3_600_000;
      // Sessions past the timeout are pruned by readActiveSessions; flag the ones
      // heading that way so a crashed agent is visible before it silently expires.
      if (ageHours > timeoutHours / 2) {
        add(
          'warning',
          'long-session',
          `has been checked in for ${ageHours.toFixed(1)}h (timeout ${timeoutHours}h) — if that agent is gone, its handoff was never written`,
          session.agent
        );
      }
    }
  } catch {
    // No sessions registry is normal — it is ephemeral and gitignored.
  }

  const violations = findings.filter((f) => f.severity === 'violation').length;
  const warnings = findings.length - violations;

  return { findings, violations, warnings, ok: violations === 0, nodesChecked };
}

/** Human-readable report. Callers set the exit code from `report.ok`. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];

  if (report.findings.length === 0) {
    lines.push(`✅ Memory folder is healthy — ${report.nodesChecked} nodes checked, no findings.`);
    return lines.join('\n');
  }

  const violations = report.findings.filter((f) => f.severity === 'violation');
  const warnings = report.findings.filter((f) => f.severity === 'warning');

  if (violations.length > 0) {
    lines.push(`✗ ${violations.length} violation${violations.length === 1 ? '' : 's'}:`);
    for (const f of violations) {
      lines.push(`  [${f.category}] ${f.subject ? `${f.subject} ` : ''}${f.message}`);
    }
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push(`⚠ ${warnings.length} warning${warnings.length === 1 ? '' : 's'}:`);
    for (const f of warnings) {
      lines.push(`  [${f.category}] ${f.subject ? `${f.subject} ` : ''}${f.message}`);
    }
    lines.push('');
  }

  lines.push(
    `${report.nodesChecked} nodes checked — ${report.violations} violations, ${report.warnings} warnings.`
  );
  return lines.join('\n');
}
