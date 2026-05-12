import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  TOOL_DEFINITIONS,
  toolInject,
  toolUpdate,
  toolLog,
  toolStatus,
  toolCheckpoint,
} from './tools.js';

export function createMastishkServer(mastishkDir: string): Server {
  const ctx = { mastishkDir };

  const server = new Server(
    { name: 'mastishk', version: '0.0.1' },
    { capabilities: { tools: {} } }
  );

  // Spec section 9: list all five required tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS as unknown as typeof TOOL_DEFINITIONS[number][],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    let text: string;
    try {
      switch (name) {
        case 'mastishk_inject':
          text = await toolInject(args as { task: string }, ctx);
          break;
        case 'mastishk_update':
          text = await toolUpdate(args as { id: string; content: string; layer: string }, ctx);
          break;
        case 'mastishk_log':
          text = await toolLog(args as { message: string; type?: string }, ctx);
          break;
        case 'mastishk_status':
          text = await toolStatus({} as Record<string, never>, ctx);
          break;
        case 'mastishk_checkpoint':
          text = await toolCheckpoint(args as { message?: string }, ctx);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      text = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    return { content: [{ type: 'text', text }] };
  });

  return server;
}
