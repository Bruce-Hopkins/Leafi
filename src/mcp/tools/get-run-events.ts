import { z } from 'zod';
import type { McpContext } from '../context';
import type { ToolDefinition } from './types';

const inputSchema = z.object({
  runId: z.string().min(1),
  afterSeq: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  reasoning: z
    .boolean()
    .optional()
    .describe('Include the model\'s reasoning text on model_call events. Off by default: it is long, so ask for a small page.'),
});

function withoutReasoning<T extends { type: string; payload: Record<string, unknown> }>(event: T): T {
  if (event.type !== 'model_call' || !('reasoning' in event.payload)) {
    return event;
  }
  const { reasoning: _reasoning, ...payload } = event.payload;
  return { ...event, payload };
}

export const getRunEventsTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name: 'get_run_events',
  description:
    'Read a bounded page of a run event log, optionally after a sequence number. model_call events carry each call\'s tokens and cost; pass reasoning: true for the model\'s reasoning text too.',
  inputSchema,
  annotations: { readOnlyHint: true },
  async handle(input, context: McpContext) {
    const events = (await context.runManager.events(input.runId, input.afterSeq ?? 0)).slice(0, input.limit ?? 100);
    // Reasoning can be 8,000 characters a call: left in, a default page could pass the result limit.
    const page = input.reasoning ? events : events.map(withoutReasoning);
    return context.results.json({ runId: input.runId, events: page });
  },
};
