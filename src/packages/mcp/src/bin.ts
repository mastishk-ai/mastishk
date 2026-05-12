#!/usr/bin/env node
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMastishkServer } from './server.js';

// Resolve .mastishk/ from --memory-dir flag, MASTISHK_DIR env var, or cwd
// SPEC-GAP: --memory-dir CLI flag not in spec section 9 — needed for MCP config files
function resolveMemoryDir(): string {
  const idx = process.argv.indexOf('--memory-dir');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1] as string;
  if (process.env['MASTISHK_DIR']) return process.env['MASTISHK_DIR'];
  return join(process.cwd(), '.mastishk');
}
const mastishkDir = resolveMemoryDir();

const server = createMastishkServer(mastishkDir);
const transport = new StdioServerTransport();

server.connect(transport).catch((err: unknown) => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
