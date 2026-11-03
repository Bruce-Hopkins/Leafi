import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { McpContext } from '../context';

/** A tool is data plus one handler. No decorators and no discovery. */
export interface ToolDefinition<Input> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  annotations?: { readOnlyHint?: boolean };
  handle(input: Input, context: McpContext): Promise<CallToolResult>;
}
