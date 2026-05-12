import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createEmptyMemoryMap, writeMemoryMap } from '@mastishk/core';
import { mastishkDir, memoryMapPath } from '../utils.js';

// Default agents.json per spec section 8
const DEFAULT_AGENTS = {
  version: '0.1',
  conflict_strategy: 'flag',
  write_back: 'required',
  registered_agents: [
    { id: 'claude-code', access: 'read-write', trust: 'high' },
    { id: 'cursor', access: 'read-write', trust: 'high' },
    { id: 'custom-agent', access: 'read-write', trust: 'medium' },
  ],
};

const CLAUDE_MD_SECTION = `
## Mastishk memory

This project uses [Mastishk](https://mastishk.dev) for persistent agent memory.

- Memory folder: \`.mastishk/\`
- Get context: \`npx mastishk inject "<your task>"\`
- Log an issue: \`npx mastishk log "description"\`
- Check health: \`npx mastishk status\`
`;

export interface InitOptions {
  cwd?: string;
  // SPEC-GAP: --template option is defined in spec section 10 but no templates are defined.
  // We silently accept and ignore it for now.
  template?: string;
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const dir = mastishkDir(cwd);

  // Warn if .mastishk/ already exists — don't overwrite silently
  let alreadyExists = false;
  try {
    await access(dir);
    alreadyExists = true;
  } catch {
    // expected — doesn't exist yet
  }

  if (alreadyExists) {
    console.warn(`Warning: .mastishk/ already exists at ${dir}. Re-initialising.`);
  }

  // Create folder structure
  for (const layer of ['intent', 'state', 'knowledge', 'issues']) {
    await mkdir(join(dir, layer), { recursive: true });
  }

  // Spec section 10: create memory-map.json with empty nodes and edges
  await writeMemoryMap(memoryMapPath(cwd), createEmptyMemoryMap());

  // Spec section 10: create agents.json with default config
  await writeFile(
    join(dir, 'agents.json'),
    JSON.stringify(DEFAULT_AGENTS, null, 2) + '\n',
    'utf-8'
  );

  // Spec section 10: append Mastishk section to CLAUDE.md if it exists
  const claudeMdPath = join(cwd, 'CLAUDE.md');
  try {
    await access(claudeMdPath);
    const existing = await readFile(claudeMdPath, 'utf-8');
    if (!existing.includes('## Mastishk memory')) {
      await writeFile(claudeMdPath, existing + CLAUDE_MD_SECTION, 'utf-8');
    }
  } catch {
    // CLAUDE.md doesn't exist — skip
  }

  console.log(`Initialised Mastishk memory at ${dir}`);
  if (options.template) {
    console.log(`Note: --template is not yet implemented. Used default template.`);
  }
}
