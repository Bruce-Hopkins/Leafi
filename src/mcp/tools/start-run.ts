import { z } from 'zod';
import type { McpContext } from '../context';
import { loadFlowReference } from './load-flow';
import type { ToolDefinition } from './types';

const inputSchema = z.object({
  flow: z.record(z.string(), z.unknown()).optional(),
  flowPath: z.string().optional(),
  input: z.string().optional(),
});

export const startRunTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name: 'start_run',
  description:
    'Start a flow asynchronously and return its run id. Poll get_run for status and outputs; use get_run_events for progress. ' +
    'Start only after the user has seen the diagram, each node\'s model and the minimum tokens, and agreed.',
  inputSchema,
  async handle(input, context: McpContext) {
    const graph = await loadFlowReference(input, context);
    const run = await context.runManager.start(graph, input.input ?? '');
    return context.results.json(run);
  },
};
