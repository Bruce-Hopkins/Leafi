import { readFlowText } from '../../app/flow-service';
import type { Graph } from '../../domain/types';
import type { McpContext } from '../context';
import { PolicyError } from '../policy';

export interface FlowReference {
  flow?: unknown;
  flowPath?: string;
}

export interface LoadedFlow {
  graph: Graph;
  /** The document as written, which is what the library saves. */
  document: unknown;
}

/** Resolves the inline document or the opted-in path the tool was given. */
export async function loadFlowReference(reference: FlowReference, context: McpContext): Promise<Graph> {
  return (await loadFlowDocument(reference, context)).graph;
}

/** The flow and the document it came from. */
export async function loadFlowDocument(reference: FlowReference, context: McpContext): Promise<LoadedFlow> {
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
    return { graph: context.flows.loadPayload(reference.flow), document: reference.flow };
  }
  if (hasPath) {
    if (!context.policy.allowFlowPaths) {
      throw new PolicyError('flowPath is disabled by the MCP server policy; pass the flow object instead.');
    }
    // "-" means stdin to the CLI, and the server's stdin is the MCP connection itself.
    if (reference.flowPath === '-') {
      throw new PolicyError('flowPath must name a file.');
    }
    const text = await readFlowText(reference.flowPath ?? '');
    const graph = await context.flows.loadText(text);
    return { graph, document: JSON.parse(text) as unknown };
  }
  throw new PolicyError('Pass a flow document or a flowPath.');
}
