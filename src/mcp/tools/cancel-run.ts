import { z } from 'zod';
import type { McpContext } from '../context';
import type { ToolDefinition } from './types';

const inputSchema = z.object({
  runId: z.string().min(1),
});

export const cancelRunTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name: 'cancel_run',
  description: 'Cancel an in-flight run. A finished run cannot be cancelled.',
  inputSchema,
  async handle(input, context: McpContext) {
    const cancelled = context.runManager.cancel(input.runId);
    return context.results.json({ runId: input.runId, cancelled });
  },
};
