import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  doctor,
  formatDoctorReport,
  commitNode,
  makeMapNode,
  markStaleByPaths,
  readMemoryMap,
  writeMemoryMap,
  createEmptyMemoryMap,
  writeAgentsConfig,
  createDefaultAgentsConfig,
  upsertNode,
} from '@mastishk/core';
import type { MskNode } from '@mastishk/core';

let tmpDir: string;
let mastishkDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-doc-'));
  mastishkDir = join(tmpDir, '.mastishk');
  await writeMemoryMap(join(mastishkDir, 'memory-map.json'), createEmptyMemoryMap());
  await writeAgentsConfig(mastishkDir, createDefaultAgentsConfig());
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function node(overrides: Partial<MskNode> = {}): MskNode {
  const now = new Date().toISOString();
  return {
    id: 'fact-stack',
    type: 'fact',
    layer: 'knowledge',
    status: 'active',
    confidence: 0.9,
    created_by: 'human',
    created_at: now,
    last_updated_by: 'human',
    last_updated_at: now,
    dependencies: [],
    contradictions: [],
    body: 'The stack is TypeScript.',
    ...overrides,
  };
}

const categories = (r: Awaited<ReturnType<typeof doctor>>) =>
  r.findings.map((f) => f.category);

describe('doctor — spec section 11', () => {
  it('reports a healthy folder as ok with no findings', async () => {
    await commitNode(mastishkDir, node());
    const report = await doctor(mastishkDir);
    expect(report.ok).toBe(true);
    expect(report.violations).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.nodesChecked).toBe(1);
  });

  it('is ok on an empty but well-formed memory folder', async () => {
    const report = await doctor(mastishkDir);
    expect(report.ok).toBe(true);
    expect(report.nodesChecked).toBe(0);
  });

  it('flags a node file that does not satisfy the schema', async () => {
    await mkdir(join(mastishkDir, 'knowledge'), { recursive: true });
    await writeFile(
      join(mastishkDir, 'knowledge', 'broken.msk.md'),
      '---\nid: broken\ntype: fact\n---\nMissing most required fields.\n',
      'utf-8'
    );
    const report = await doctor(mastishkDir);
    expect(report.ok).toBe(false);
    expect(categories(report)).toContain('schema');
  });

  it('flags a type that is not allowed in its layer', async () => {
    await mkdir(join(mastishkDir, 'knowledge'), { recursive: true });
    const now = new Date().toISOString();
    await writeFile(
      join(mastishkDir, 'knowledge', 'wrong-layer.msk.md'),
      `---\nid: wrong-layer\ntype: task\nlayer: knowledge\nstatus: active\nconfidence: 1\ncreated_by: x\ncreated_at: ${now}\nlast_updated_by: x\nlast_updated_at: ${now}\ndependencies: []\ncontradictions: []\n---\nA task in the knowledge layer.\n`,
      'utf-8'
    );
    const report = await doctor(mastishkDir);
    expect(report.ok).toBe(false);
    expect(categories(report)).toContain('schema');
  });

  it('flags duplicate IDs across two files', async () => {
    await commitNode(mastishkDir, node({ id: 'fact-dup' }));
    // Same id, different layer directory — the filesystem allows it, the spec does not
    await mkdir(join(mastishkDir, 'intent'), { recursive: true });
    const now = new Date().toISOString();
    await writeFile(
      join(mastishkDir, 'intent', 'fact-dup.msk.md'),
      `---\nid: fact-dup\ntype: goal\nlayer: intent\nstatus: active\nconfidence: 1\ncreated_by: x\ncreated_at: ${now}\nlast_updated_by: x\nlast_updated_at: ${now}\ndependencies: []\ncontradictions: []\n---\nA goal reusing an existing id.\n`,
      'utf-8'
    );
    const report = await doctor(mastishkDir);
    expect(report.ok).toBe(false);
    expect(categories(report)).toContain('duplicate-id');
  });

  it('flags a dangling dependency in the graph', async () => {
    await commitNode(mastishkDir, node({ id: 'fact-a', dependencies: ['does-not-exist'] }));
    const report = await doctor(mastishkDir);
    expect(report.ok).toBe(false);
    expect(categories(report)).toContain('graph');
  });

  it('flags an index entry whose node file is missing', async () => {
    const mapPath = join(mastishkDir, 'memory-map.json');
    const map = await readMemoryMap(mapPath);
    await writeMemoryMap(
      mapPath,
      upsertNode(map, 'ghost', {
        file: 'knowledge/ghost.msk.md',
        layer: 'knowledge',
        type: 'fact',
        status: 'active',
        confidence: 1,
        dependencies: [],
      })
    );
    const report = await doctor(mastishkDir);
    expect(report.ok).toBe(false);
    expect(categories(report)).toContain('missing-file');
  });

  it('warns about a node on disk that the index has never heard of', async () => {
    await mkdir(join(mastishkDir, 'knowledge'), { recursive: true });
    const now = new Date().toISOString();
    await writeFile(
      join(mastishkDir, 'knowledge', 'orphan.msk.md'),
      `---\nid: orphan\ntype: fact\nlayer: knowledge\nstatus: active\nconfidence: 1\ncreated_by: x\ncreated_at: ${now}\nlast_updated_by: x\nlast_updated_at: ${now}\ndependencies: []\ncontradictions: []\n---\nNot indexed.\n`,
      'utf-8'
    );
    const report = await doctor(mastishkDir);
    expect(categories(report)).toContain('unindexed-node');
    // An unindexed node is invisible to inject but does not break the spec
    expect(report.ok).toBe(true);
  });

  it('warns about stale map entries without failing the run', async () => {
    await commitNode(mastishkDir, makeMapNode('map-auth', 'src/auth.ts', 'Auth.', {
      created_by: 'mastishk-cli', last_updated_by: 'mastishk-cli',
    }));
    await markStaleByPaths(mastishkDir, ['src/auth.ts']);

    const report = await doctor(mastishkDir);
    expect(categories(report)).toContain('stale-map');
    expect(report.ok).toBe(true);
    expect(report.warnings).toBeGreaterThan(0);
  });

  it('warns about an expired unresolved issue (spec 4.5)', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    await commitNode(mastishkDir, node({
      id: 'issue-old',
      type: 'issue',
      layer: 'issues',
      status: 'active',
      expires_at: past,
      body: 'An issue that has expired.',
    }));
    const report = await doctor(mastishkDir);
    expect(categories(report)).toContain('expired');
    expect(report.ok).toBe(true);
  });

  it('does not warn about an expired issue that is already resolved', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    await commitNode(mastishkDir, node({
      id: 'issue-done',
      type: 'issue',
      layer: 'issues',
      status: 'resolved',
      expires_at: past,
      body: 'Expired but resolved.',
    }));
    const report = await doctor(mastishkDir);
    expect(categories(report)).not.toContain('expired');
  });
});

describe('formatDoctorReport', () => {
  it('says so plainly when there is nothing wrong', async () => {
    await commitNode(mastishkDir, node());
    const out = formatDoctorReport(await doctor(mastishkDir));
    expect(out).toContain('healthy');
    expect(out).toContain('1 nodes checked');
  });

  it('separates violations from warnings and names the subject', async () => {
    await commitNode(mastishkDir, node({ id: 'fact-a', dependencies: ['nope'] }));
    const out = formatDoctorReport(await doctor(mastishkDir));
    expect(out).toContain('violation');
    expect(out).toContain('[graph]');
  });

  it('gives an actionable next step for a stale map entry', async () => {
    await commitNode(mastishkDir, makeMapNode('map-auth', 'src/auth.ts', 'Auth.', {
      created_by: 'mastishk-cli', last_updated_by: 'mastishk-cli',
    }));
    await markStaleByPaths(mastishkDir, ['src/auth.ts']);
    const out = formatDoctorReport(await doctor(mastishkDir));
    expect(out).toContain('mastishk map --refresh map-auth');
  });
});
