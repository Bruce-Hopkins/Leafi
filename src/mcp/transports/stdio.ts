import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** JSON-RPC over stdin/stdout. Nothing else may write to stdout. */
export async function serveStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}
