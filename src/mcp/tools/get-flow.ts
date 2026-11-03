import { z } from 'zod';
import type { McpContext } from '../context';
import type { ToolDefinition } from './types';

const inputSchema = z.object({
  name: z.string().min(1).describe('The flow\'s name, as list_flows shows it.'),
});

export const getFlowTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name: 'get_flow',
  description: 'Return a saved flow\'s document and file by name, to change it or run it again.',
  inputSchema,
  annotations: { readOnlyHint: true },
  async handle(input, context: McpContext) {
    const saved = await context.library.read(input.name);
    if (!saved) {
      return context.results.error(`No saved flow is named "${input.name}". Call list_flows for the saved names.`);
    }
    return context.results.json({ name: input.name, file: saved.file, flow: saved.document });
  },
};
