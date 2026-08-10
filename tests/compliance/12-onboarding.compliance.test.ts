/**
 * Compliance: spec v0.3 section 14 — agent onboarding via AGENTS.md and CLAUDE.md
 * - 14.1 AGENTS.md is the canonical location; CLAUDE.md mirrors it
 * - 14.2 detection rules: append / create / leave alone; instruct MAY replace
 * - 14.3 the section format contains heading, session-start instruction,
 *        memory layers, and end-of-session instructions
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initCommand } from '../../src/packages/cli/src/commands/init.js';
import { instructCommand } from '../../src/packages/cli/src/commands/instruct.js';
import {
  injectBriefing,
  injectAllBriefings,
  MASTISHK_SECTION,
  MASTISHK_HEADING,
  ONBOARDING_FILES,
} from '../../src/packages/cli/src/commands/onboarding.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'msk-c12-'));
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const read = (f: string) => readFile(join(tmpDir, f), 'utf-8');

// ---------------------------------------------------------------------------
// Section 14.1 — AGENTS.md is canonical
// ---------------------------------------------------------------------------

describe('section 14.1 — AGENTS.md is the canonical onboarding file', () => {
  it('AGENTS.md comes first in the onboarding file list', () => {
    expect(ONBOARDING_FILES[0]).toBe('AGENTS.md');
  });

  it('init writes both AGENTS.md and CLAUDE.md', async () => {
    await initCommand({ cwd: tmpDir });
    await expect(access(join(tmpDir, 'AGENTS.md'))).resolves.toBeUndefined();
    await expect(access(join(tmpDir, 'CLAUDE.md'))).resolves.toBeUndefined();
  });

  it('CLAUDE.md receives a mirror of the same section', async () => {
    await initCommand({ cwd: tmpDir });
    const agents = await read('AGENTS.md');
    const claude = await read('CLAUDE.md');
    expect(agents).toBe(claude);
  });
});

// ---------------------------------------------------------------------------
// Section 14.2 — detection and injection rules
// ---------------------------------------------------------------------------

describe('section 14.2 — detection and injection rules', () => {
  for (const file of ONBOARDING_FILES) {
    it(`${file}: created with the section as sole content when absent`, async () => {
      const outcome = await injectBriefing(tmpDir, file);
      expect(outcome).toBe('created');
      expect(await read(file)).toBe(MASTISHK_SECTION.trimStart());
    });

    it(`${file}: section appended when the file exists without it`, async () => {
      await writeFile(join(tmpDir, file), '# My Project\n\nExisting content.\n', 'utf-8');
      const outcome = await injectBriefing(tmpDir, file);
      expect(outcome).toBe('appended');

      const content = await read(file);
      expect(content).toContain('Existing content.');
      expect(content).toContain(MASTISHK_HEADING);
      // The project's own content MUST survive
      expect(content.indexOf('Existing content.')).toBeLessThan(content.indexOf(MASTISHK_HEADING));
    });

    it(`${file}: left unchanged when the section is already present`, async () => {
      const original = `# My Project\n\n${MASTISHK_HEADING}\n\nSomething custom.\n`;
      await writeFile(join(tmpDir, file), original, 'utf-8');
      const outcome = await injectBriefing(tmpDir, file);
      expect(outcome).toBe('unchanged');
      expect(await read(file)).toBe(original);
    });

    it(`${file}: replace only happens when explicitly asked`, async () => {
      const original = `# My Project\n\n${MASTISHK_HEADING}\n\nOld briefing.\n`;
      await writeFile(join(tmpDir, file), original, 'utf-8');
      const outcome = await injectBriefing(tmpDir, file, { replace: true });
      expect(outcome).toBe('replaced');

      const content = await read(file);
      expect(content).not.toContain('Old briefing.');
      expect(content).toContain('mastishk session start');
      expect(content).toContain('# My Project');
    });
  }

  it('replacing preserves project content that follows the section', async () => {
    const original = `# My Project\n\n${MASTISHK_HEADING}\n\nOld briefing.\n\n## Our own rules\n\nDo not delete this.\n`;
    await writeFile(join(tmpDir, 'AGENTS.md'), original, 'utf-8');
    await injectBriefing(tmpDir, 'AGENTS.md', { replace: true });

    const content = await read('AGENTS.md');
    expect(content).toContain('## Our own rules');
    expect(content).toContain('Do not delete this.');
    expect(content).not.toContain('Old briefing.');
  });

  it('init MUST NOT overwrite an existing section (14.2)', async () => {
    const original = `${MASTISHK_HEADING}\n\nHand-tuned briefing we want kept.\n`;
    await writeFile(join(tmpDir, 'AGENTS.md'), original, 'utf-8');
    await initCommand({ cwd: tmpDir });
    expect(await read('AGENTS.md')).toBe(original);
  });

  it('init is idempotent — a second run does not duplicate the section', async () => {
    await initCommand({ cwd: tmpDir });
    await initCommand({ cwd: tmpDir });
    for (const file of ONBOARDING_FILES) {
      const content = await read(file);
      const count = (content.match(new RegExp(MASTISHK_HEADING, 'g')) ?? []).length;
      expect(count).toBe(1);
    }
  });

  it('instruct MAY replace an existing section with the canonical format', async () => {
    await initCommand({ cwd: tmpDir });
    await writeFile(
      join(tmpDir, 'AGENTS.md'),
      `${MASTISHK_HEADING}\n\nStale v0.2 briefing telling agents to run mastishk inject.\n`,
      'utf-8'
    );
    await instructCommand({ cwd: tmpDir, agent: 'claude-code' });

    const content = await read('AGENTS.md');
    expect(content).not.toContain('Stale v0.2 briefing');
    expect(content).toContain('mastishk session start');
  });
});

// ---------------------------------------------------------------------------
// Section 14.3 — section format
// ---------------------------------------------------------------------------

describe('section 14.3 — canonical section format', () => {
  it('contains the ## Mastishk memory heading', () => {
    expect(MASTISHK_SECTION).toContain(MASTISHK_HEADING);
  });

  it('contains the session-start instruction', () => {
    expect(MASTISHK_SECTION).toContain('mastishk session start');
  });

  it('contains end-of-session instructions', () => {
    expect(MASTISHK_SECTION).toContain('mastishk session end');
    expect(MASTISHK_SECTION).toContain('Done / In flight / Watch out / Next');
  });

  it('describes every memory layer, including map/', () => {
    for (const layer of ['intent/', 'state/', 'knowledge/', 'map/', 'issues/']) {
      expect(MASTISHK_SECTION).toContain(`.mastishk/${layer}`);
    }
  });

  it('tells agents what to do about a stale map entry', () => {
    expect(MASTISHK_SECTION.toLowerCase()).toContain('stale');
  });

  it('states that memory is shared between agents', () => {
    expect(MASTISHK_SECTION.toLowerCase()).toContain('shared');
  });
});

// ---------------------------------------------------------------------------
// The briefing an agent actually reads must match what init writes
// ---------------------------------------------------------------------------

describe('section 14 — written briefing matches the canonical format', () => {
  it('every onboarding file init writes contains the canonical section', async () => {
    const results = await injectAllBriefings(tmpDir);
    expect(results.map((r) => r.file)).toEqual([...ONBOARDING_FILES]);
    for (const { file } of results) {
      expect(await read(file)).toContain(MASTISHK_SECTION.trim());
    }
  });
});
