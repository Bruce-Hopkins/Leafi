import { z } from 'zod';
import type { McpContext } from '../context';
import type { ToolDefinition } from './types';

const inputSchema = z.object({});

export const listProvidersTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name: 'list_providers',
  description: 'List the providers whose API keys are configured, with their models.',
  inputSchema,
  annotations: { readOnlyHint: true },
  async handle(_input, context: McpContext) {
    return context.results.json(await context.providers.list());
  },
};
