#!/usr/bin/env node
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMastishkServer } from './server.js';

// Resolve .mastishk/ from MASTISHK_DIR env var or cwd
const mastishkDir = process.env['MASTISHK_DIR']
  ? process.env['MASTISHK_DIR']
  : join(process.cwd(), '.mastishk');

const server = createMastishkServer(mastishkDir);
const transport = new StdioServerTransport();

server.connect(transport).catch((err: unknown) => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
