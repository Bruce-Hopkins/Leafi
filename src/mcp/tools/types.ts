import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { McpContext } from '../context';
import type { AskPerson } from '../permission-request';

/** What the server offers one tool call besides the shared context. */
export interface ToolCall {
  /** Asks the person through the client; absent when the client cannot show a question. */
  ask?: AskPerson;
}

/** A tool is data plus one handler. No decorators and no discovery. */
export interface ToolDefinition<Input> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  annotations?: { readOnlyHint?: boolean };
  handle(input: Input, context: McpContext, call: ToolCall): Promise<CallToolResult>;
}
