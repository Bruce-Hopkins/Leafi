import type { Graph } from '../../domain/types';
import type { McpContext } from '../context';
import { PolicyError } from '../policy';

export interface FlowReference {
  flow?: unknown;
  flowPath?: string;
}

/** Resolves the inline document or the opted-in path the tool was given. */
export async function loadFlowReference(reference: FlowReference, context: McpContext): Promise<Graph> {
  const hasFlow = reference.flow !== undefined;
  const hasPath = reference.flowPath !== undefined && reference.flowPath.length > 0;

  if (hasFlow && hasPath) {
    throw new PolicyError('Pass either flow or flowPath, not both.');
  }
  if (hasFlow) {
    const bytes = Buffer.byteLength(JSON.stringify(reference.flow), 'utf8');
    if (bytes > context.policy.maxFlowBytes) {
      throw new PolicyError(`The flow document is ${bytes} bytes; the limit is ${context.policy.maxFlowBytes}.`);
    }
    return context.flows.loadPayload(reference.flow);
  }
  if (hasPath) {
    if (!context.policy.allowFlowPaths) {
      throw new PolicyError('flowPath is disabled by the MCP server policy; pass the flow object instead.');
    }
    return context.flows.loadPath(reference.flowPath ?? '');
  }
  throw new PolicyError('Pass a flow document or a flowPath.');
}
