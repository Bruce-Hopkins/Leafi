import { z } from 'zod';
import type { McpContext } from '../context';
import type { ToolDefinition } from './types';

const inputSchema = z.object({});

export const listFlowsTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name: 'list_flows',
  description:
    'List the saved flows, most recent first: every flow start_run has run, by name, with its file. ' +
    'Check here before designing a flow the user may already have. Run one again with start_run and flowPath set to its file; ' +
    'get_flow returns its document to change it.',
  inputSchema,
  annotations: { readOnlyHint: true },
  async handle(_input, context: McpContext) {
    return context.results.json({ flows: await context.library.list() });
  },
};
