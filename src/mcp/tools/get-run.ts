import { z } from 'zod';
import type { McpContext } from '../context';
import type { ToolDefinition } from './types';

const inputSchema = z.object({
  runId: z.string().min(1),
});

export const getRunTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name: 'get_run',
  description: 'Get a run by id: status, outputs, personOutput (the person-facing deliverable), usage, cost, background jobs and any error.',
  inputSchema,
  annotations: { readOnlyHint: true },
  async handle(input, context: McpContext) {
    const run = await context.runManager.get(input.runId);
    if (!run) {
      return context.results.error(`No run with id "${input.runId}".`);
    }
    return context.results.json(run);
  },
};
