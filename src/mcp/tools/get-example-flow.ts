import { z } from 'zod';
import { EXAMPLE_FLOW } from '../../app/flow-schema';
import type { McpContext } from '../context';
import type { ToolDefinition } from './types';

const inputSchema = z.object({});

export const getExampleFlowTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name: 'get_example_flow',
  description: 'Return a runnable example flow document.',
  inputSchema,
  annotations: { readOnlyHint: true },
  async handle(_input, context: McpContext) {
    return context.results.json(EXAMPLE_FLOW);
  },
};
