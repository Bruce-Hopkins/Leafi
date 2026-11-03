import { z } from 'zod';
import { renderFlow } from '../../app/flow-renderer';
import { validateFlow } from '../../app/flow-validation';
import type { Graph } from '../../domain/types';
import type { McpContext } from '../context';
import { loadFlowReference } from './load-flow';
import type { ToolDefinition } from './types';

const inputSchema = z.object({
  flow: z.record(z.string(), z.unknown()).optional(),
  flowPath: z.string().optional(),
});

/**
 * Rides along with every validation, because a model validates before it hands
 * a flow over: the drawing and the reminder arrive exactly when they are needed,
 * with no separate render_flow call to forget.
 */
export const DIAGRAM_REPLY =
  'Show "diagram" to the user every time you hand over or change a flow; it names each node\'s model. ' +
  'Before start_run, state each node\'s model and minimum.totalTokens (a lower bound, not a forecast), and wait for the user to agree.';

export const validateFlowTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name: 'validate_flow',
  description:
    'Check a flow for structural issues and design warnings without running it. ' +
    'The result includes the flow\'s diagram: put it in your reply whenever you hand over or change a flow.',
  inputSchema,
  annotations: { readOnlyHint: true },
  async handle(input, context: McpContext) {
    const graph = await loadFlowReference(input, context);
    const diagram = drawing(graph);
    return context.results.json({
      ...validateFlow(graph, context.config),
      ...(diagram !== undefined ? { diagram } : {}),
      reply: DIAGRAM_REPLY,
    });
  },
};

/** The drawing is a courtesy: a flow too broken to draw is still validated, and its issues explain why. */
function drawing(graph: Graph): string | undefined {
  try {
    return renderFlow(graph, 'ascii');
  } catch {
    return undefined;
  }
}
