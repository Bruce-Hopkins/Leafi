import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from './context';
import { withToolErrors } from './errors';
import { TOOLS } from './registry';
import { registerResources } from './resources';
import { VERSION } from '../version';

export function createMcpServer(context: McpContext): McpServer {
  const server = new McpServer({ name: 'agents-automations', version: VERSION });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (input: unknown) => withToolErrors(() => tool.handle(input as never, context), context),
    );
  }

  registerResources(server);
  return server;
}
