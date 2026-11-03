import { findNode, incomingEdges, outgoingEdges, routesToAll } from '../domain/graph-utils';
import type { AgentNode, Graph, GraphEdge } from '../domain/types';
import type { RunState } from './run-state';

export type EdgeStatus = 'taken' | 'dead';

/** Valid once the edge's source has executed, which LangGraph guarantees before a target runs. */
export function edgeStatus(graph: Graph, edge: GraphEdge, state: RunState): EdgeStatus {
  if (state.skipped[edge.source]) {
    return 'dead';
  }
  const source = findNode(graph, edge.source);
  if (!source) {
    return 'dead';
  }
  if (routesToAll(graph, source)) {
    return 'taken';
  }
  return state.branches[edge.source] === (edge.branch ?? '').trim() ? 'taken' : 'dead';
}

export function takenIncoming(graph: Graph, nodeId: string, state: RunState): GraphEdge[] {
  return incomingEdges(graph, nodeId).filter((edge) => edgeStatus(graph, edge, state) === 'taken');
}

/** The edges a node takes after finishing with `next`. */
export function takenOutgoing(graph: Graph, node: AgentNode, next: string | undefined): GraphEdge[] {
  const outgoing = outgoingEdges(graph, node.id);
  if (routesToAll(graph, node)) {
    return outgoing;
  }
  return outgoing.filter((edge) => (edge.branch ?? '').trim() === (next ?? '').trim());
}
