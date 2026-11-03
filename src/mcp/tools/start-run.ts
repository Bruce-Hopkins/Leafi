import { z } from 'zod';
import { lintParallelLimit } from '../../domain/flow-lint';
import type { McpContext } from '../context';
import { requestPermissions } from '../permission-request';
import { loadFlowDocument } from './load-flow';
import type { ToolCall, ToolDefinition } from './types';

const inputSchema = z.object({
  flow: z.record(z.string(), z.unknown()).optional(),
  flowPath: z.string().optional(),
  input: z.string().optional(),
});

export const startRunTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name: 'start_run',
  description:
    'Start a flow asynchronously and return its run id. Poll get_run for status and outputs; use get_run_events for progress. ' +
    'Start only after the user has seen the diagram, each node\'s model and the minimum tokens, and agreed. ' +
    'If the flow needs a permission that is turned off, the server asks the user directly. ' +
    'The flow is saved under its name (replacing a saved flow with the same name) and "flowFile" is its path: ' +
    'list_flows finds it in a later conversation, and flowPath runs it again.',
  inputSchema,
  async handle(input, context: McpContext, call: ToolCall) {
    const { graph, document } = await loadFlowDocument(input, context);
    const granted = await requestPermissions(graph, context, call.ask);
    const flowFile = await saveFlow(context, graph.name, document);
    const run = await context.runManager.start(graph, input.input ?? '', granted);
    const warnings = lintParallelLimit(graph, context.config.maxParallelNodes).map(({ message, hint }) => `${message} ${hint}`);
    return context.results.json({
      ...run,
      ...(flowFile !== undefined ? { flowFile } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  },
};

/** A flow that cannot be saved still runs: the person agreed to run it, and saving is a convenience. */
async function saveFlow(context: McpContext, name: string, document: unknown): Promise<string | undefined> {
  try {
    return await context.library.save(name, document);
  } catch (error) {
    context.logger.error(`Could not save the flow "${name}"`, error);
    return undefined;
  }
}
