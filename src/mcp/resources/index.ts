import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerExampleResource } from './examples';
import { registerFlowSchemaResource } from './flow-schema';

export function registerResources(server: McpServer): void {
  registerFlowSchemaResource(server);
  registerExampleResource(server);
}
