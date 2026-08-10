import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Packaging invariants.
//
// These exist because the published 0.1.0 shipped a stale dist/ that was missing
// the `hook` and `instruct` commands, which broke ambient capture for every npm
// user for three months (issue-stale-npm-hook). Every test in the suite passed
// throughout, because they all call the command functions directly and never
// look at what actually gets published.

const ROOT = join(__dirname, '..', '..');
const PACKAGES = ['core', 'cli', 'mcp'] as const;

async function pkg(name: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(ROOT, 'src', 'packages', name, 'package.json'), 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('packaging — version consistency', () => {
  it('all three packages share one version', async () => {
    const versions = await Promise.all(PACKAGES.map(async (p) => (await pkg(p))['version']));
    expect(new Set(versions).size).toBe(1);
  });

  it('cli and mcp pin the exact core version they ship with', async () => {
    // A stale pin here means `npm i @mastishk/cli` silently resolves an older
    // core than the one the CLI was built and tested against.
    const coreVersion = (await pkg('core'))['version'];
    for (const name of ['cli', 'mcp'] as const) {
      const deps = (await pkg(name))['dependencies'] as Record<string, string>;
      expect(deps['@mastishk/core'], `${name} pins core`).toBe(coreVersion);
    }
  });

  it('the CLI reports its real version, not a hardcoded one', async () => {
    const bin = await readFile(
      join(ROOT, 'src', 'packages', 'cli', 'src', 'bin.ts'),
      'utf-8'
    );
    // `mastishk --version` must derive from package.json. A literal here drifts
    // silently and misreports which build a user is running.
    expect(bin).not.toMatch(/\.version\(\s*['"]\d+\.\d+\.\d+['"]\s*\)/);
    expect(bin).toContain('packageVersion()');
  });

  it('the MCP server reports its real version in the handshake', async () => {
    const server = await readFile(
      join(ROOT, 'src', 'packages', 'mcp', 'src', 'server.ts'),
      'utf-8'
    );
    expect(server).not.toMatch(/version:\s*['"]\d+\.\d+\.\d+['"]/);
    expect(server).toContain('packageVersion()');
  });
});

describe('packaging — publish safety', () => {
  it('every package rebuilds before publishing', async () => {
    // Without this, `npm publish` ships whatever happens to be sitting in dist/.
    // That is exactly how 0.1.0 went out missing two commands.
    for (const name of PACKAGES) {
      const scripts = (await pkg(name))['scripts'] as Record<string, string>;
      expect(scripts['prepublishOnly'], `${name} prepublishOnly`).toBe('npm run build');
    }
  });

  it('every package ships dist and a README', async () => {
    for (const name of PACKAGES) {
      const files = (await pkg(name))['files'] as string[];
      expect(files, `${name} files`).toContain('dist');
      expect(files, `${name} files`).toContain('README.md');
    }
  });

  it('the CLI declares the mastishk binary', async () => {
    const bin = (await pkg('cli'))['bin'] as Record<string, string>;
    expect(bin['mastishk']).toBe('./dist/bin.js');
  });

  it('library packages resolve for every consumer', async () => {
    // `types` must come first — TypeScript takes the first matching condition,
    // so listing it last makes node16/bundler resolution miss the declarations.
    // `default` must exist or require() fails outright, which is how the
    // testbed harness first hit ERR_PACKAGE_PATH_NOT_EXPORTED.
    for (const name of ['core', 'mcp'] as const) {
      const exp = (await pkg(name))['exports'] as Record<string, Record<string, string>>;
      const conditions = Object.keys(exp['.']!);
      expect(conditions[0], `${name} lists types first`).toBe('types');
      expect(conditions, `${name} has a default condition`).toContain('default');
    }
  });
});

describe('packaging — README claims match the CLI', () => {
  it('the CLI README documents every registered command', async () => {
    // The published README is the landing page. It shipped for months describing
    // 8 commands while the CLI had 15.
    const bin = await readFile(
      join(ROOT, 'src', 'packages', 'cli', 'src', 'bin.ts'),
      'utf-8'
    );
    const readme = await readFile(
      join(ROOT, 'src', 'packages', 'cli', 'README.md'),
      'utf-8'
    );

    // `start` and `end` are registered on the `session` subcommand, so they are
    // documented under their full invocation.
    const SUBCOMMAND_OF_SESSION = new Set(['start', 'end']);

    const commands = [...bin.matchAll(/\.command\('([a-z-]+)/g)].map((m) => m[1]!);
    expect(commands.length).toBeGreaterThan(10);

    for (const command of new Set(commands)) {
      const invocation = SUBCOMMAND_OF_SESSION.has(command)
        ? `mastishk session ${command}`
        : `mastishk ${command}`;
      expect(readme, `README documents "${invocation}"`).toContain(invocation);
    }
  });

  it('the MCP README documents every exposed tool', async () => {
    const tools = await readFile(
      join(ROOT, 'src', 'packages', 'mcp', 'src', 'tools.ts'),
      'utf-8'
    );
    const readme = await readFile(
      join(ROOT, 'src', 'packages', 'mcp', 'README.md'),
      'utf-8'
    );

    const names = [...tools.matchAll(/name: '(mastishk_[a-z_]+)'/g)].map((m) => m[1]!);
    expect(new Set(names).size).toBe(8);

    for (const name of new Set(names)) {
      expect(readme, `README documents ${name}`).toContain(name);
    }
  });
});
