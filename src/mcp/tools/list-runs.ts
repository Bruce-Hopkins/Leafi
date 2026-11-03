import { z } from 'zod';
import type { McpContext } from '../context';
import type { ToolDefinition } from './types';

const inputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

export const listRunsTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name: 'list_runs',
  description: 'List recent runs, newest first.',
  inputSchema,
  annotations: { readOnlyHint: true },
  async handle(input, context: McpContext) {
    return context.results.json(await context.runManager.list(input.limit ?? 20));
  },
};
