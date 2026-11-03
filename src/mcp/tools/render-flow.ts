import { z } from 'zod';
import { renderFlow } from '../../app/flow-renderer';
import type { McpContext } from '../context';
import { loadFlowReference } from './load-flow';
import type { ToolDefinition } from './types';

const inputSchema = z.object({
  flow: z.record(z.string(), z.unknown()).optional(),
  flowPath: z.string().optional(),
  format: z.enum(['ascii', 'mermaid', 'dot']).optional(),
});

export const renderFlowTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name: 'render_flow',
  description:
    'Draw a flow as ASCII, Mermaid or DOT. validate_flow already returns the ASCII drawing; use this for Mermaid or DOT, ' +
    'and include the drawing in your reply.',
  inputSchema,
  annotations: { readOnlyHint: true },
  async handle(input, context: McpContext) {
    const graph = await loadFlowReference(input, context);
    return context.results.text(renderFlow(graph, input.format ?? 'ascii'));
  },
};
