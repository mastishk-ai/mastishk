#!/usr/bin/env node
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

program
  .name('mastishk')
  .description('Persistent structured memory for AI coding agents.')
  .version('0.0.1');

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
