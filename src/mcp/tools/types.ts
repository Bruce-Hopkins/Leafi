import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { McpContext } from '../context';
import type { AskPerson } from '../permission-request';

/** What the server offers one tool call besides the shared context. */
export interface ToolCall {
  /** Asks the person through the client; absent when the client cannot show a question. */
  ask?: AskPerson;
  /** Aborts when the client cancels this call. */
  signal?: AbortSignal;
  /**
   * Sends a progress notification for this call; absent when the client sent
   * no progress token. Each one also resets the timeout of a client that
   * resets on progress.
   */
  progress?: (message: string) => Promise<void>;
  /**
   * The client is a leafi plugin that shows run progress itself: it declared
   * `experimental["leafi/run-events"]` and is sent `notifications/leafi/run`.
   */
  pluginDelivery: boolean;
}

/** A tool is data plus one handler. No decorators and no discovery. */
export interface ToolDefinition<Input> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  annotations?: { readOnlyHint?: boolean };
  handle(input: Input, context: McpContext, call: ToolCall): Promise<CallToolResult>;
}
