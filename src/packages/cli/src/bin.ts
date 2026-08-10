#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { program } from 'commander';
import { initCommand } from './commands/init.js';
import { injectCommand } from './commands/inject-cmd.js';
import { updateCommand } from './commands/update-cmd.js';
import { logCommand } from './commands/log-cmd.js';
import { statusCommand } from './commands/status.js';
import { checkpointCommand } from './commands/checkpoint.js';
import { scanCommand } from './commands/scan.js';
import { instructCommand } from './commands/instruct.js';
import type { AgentName } from './commands/instruct.js';
import { hookCommand } from './commands/hook.js';
import { sessionStartCommand, sessionEndCommand } from './commands/session-cmd.js';
import { catchupCommand } from './commands/catchup-cmd.js';
import { mapCommand } from './commands/map-cmd.js';
import { nextCommand } from './commands/next-cmd.js';
import { doctorCommand } from './commands/doctor-cmd.js';

// Read the version from package.json rather than hardcoding it — a hardcoded
// string drifts silently, and `mastishk --version` reporting the wrong number is
// the one thing a user checks when a release does not behave as expected.
// dist/bin.js sits one level below the package root.
function packageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8')) as {
      version?: string;
    };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

program
  .name('mastishk')
  .description('Persistent structured memory for AI coding agents.')
  .version(packageVersion());

// Spec section 10: mastishk init [--template <name>]
program
  .command('init')
  .description('Scaffold .mastishk/ in the current project.')
  .option('--template <name>', 'memory template to use')
  .action(async (opts) => {
    await initCommand({ template: opts.template }).catch(die);
  });

// Spec section 10: mastishk inject <task>
program
  .command('inject <task>')
  .description('Get structured memory context for a task.')
  .action(async (task: string) => {
    await injectCommand(task).catch(die);
  });

// Spec section 10: mastishk update <id> [--status <status>] [--confidence <float>]
program
  .command('update <id>')
  .description('Update status or confidence of a memory node.')
  .option('--status <status>', 'new status (active|resolved|deprecated|draft)')
  .option('--confidence <float>', 'new confidence score (0.0–1.0)')
  .action(async (id: string, opts) => {
    await updateCommand(id, opts).catch(die);
  });

// Spec section 10: mastishk log [--error] <message>
program
  .command('log <message>')
  .description('Append an issue or error to memory.')
  .option('--error', 'tag this log entry as an error')
  .action(async (message: string, opts) => {
    await logCommand(message, { error: opts.error }).catch(die);
  });

// Spec section 15: mastishk session start / session end
const session = program
  .command('session')
  .description('Session protocol: check in → catch up → work → hand off.');

session
  .command('start')
  .description('Check in: register presence, catch up, get task context.')
  .requiredOption('--agent <id>', 'your agent ID, e.g. claude-code')
  .option('--task <task>', 'what you are about to work on')
  .action(async (opts) => {
    await sessionStartCommand({ agent: opts.agent, task: opts.task }).catch(die);
  });

session
  .command('end')
  .description('Hand off: write a handoff note, deregister, checkpoint.')
  .option('--agent <id>', 'agent ID (inferred when exactly one session is active)')
  .option('--handoff <text>', 'handoff note: Done / In flight / Watch out / Next')
  .action(async (opts) => {
    await sessionEndCommand({ agent: opts.agent, handoff: opts.handoff }).catch(die);
  });

// Spec section 15.4: mastishk catchup [--agent <id>]
program
  .command('catchup')
  .description('What changed in memory since your last session.')
  .option('--agent <id>', 'agent ID (inferred when exactly one session is active)')
  .action(async (opts) => {
    await catchupCommand({ agent: opts.agent }).catch(die);
  });

// Spec section 11: mastishk next
program
  .command('next')
  .description('First unblocked step of the most recently updated active plan.')
  .action(async () => {
    await nextCommand().catch(die);
  });

// Spec section 11: mastishk map [--stale] [--refresh <id>]
program
  .command('map')
  .description('Inspect the codebase map: which file does what.')
  .option('--stale', 'show only entries flagged stale by ambient capture')
  .option('--refresh <id>', 'clear the stale flag after verifying an entry')
  .action(async (opts) => {
    await mapCommand({ stale: opts.stale, refresh: opts.refresh }).catch(die);
  });

// Spec section 11: mastishk doctor — non-zero exit on any MUST-level violation
program
  .command('doctor')
  .description('Lint the whole memory folder; exits non-zero on spec violations.')
  .action(async () => {
    const report = await doctorCommand().catch(die);
    if (!report.ok) process.exitCode = 1;
  });

// Spec section 10: mastishk status
program
  .command('status')
  .description('Show memory health summary.')
  .action(async () => {
    await statusCommand().catch(die);
  });

// Spec section 10: mastishk checkpoint [--message <msg>]
program
  .command('checkpoint')
  .description('Commit current memory state to git.')
  .option('--message <msg>', 'commit message')
  .action(async (opts) => {
    await checkpointCommand({ message: opts.message }).catch(die);
  });

// Spec section 10: mastishk scan [--yes]
program
  .command('scan')
  .description('Infer memory nodes from existing project files.')
  .option('--yes', 'auto-accept all inferred nodes without prompting')
  .action(async (opts) => {
    await scanCommand({ autoConfirm: opts.yes ? 'yes' : undefined }).catch(die);
  });

// SPEC-GAP: instruct command not in spec — proposed as section 11
program
  .command('instruct')
  .description('Generate agent-specific briefing and write agent config files.')
  .requiredOption('--agent <name>', 'agent to configure (claude-code|cursor|windsurf|api)')
  .action(async (opts) => {
    await instructCommand({ agent: opts.agent as AgentName }).catch(die);
  });

// SPEC-GAP: hook command not in spec — proposed as section 12
// Runs automatically via post-commit git hook installed by mastishk init
program
  .command('hook')
  .description('Post-commit git hook: auto-update state memory from commit message.')
  .action(async () => {
    await hookCommand().catch(die);
  });

function die(err: unknown): never {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}

program.parse();
