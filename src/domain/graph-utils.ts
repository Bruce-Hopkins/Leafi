import type { AgentNode, Graph, GraphEdge } from './types';

export function outgoingEdges(graph: Graph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((edge) => edge.source === nodeId);
}

export function incomingEdges(graph: Graph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((edge) => edge.target === nodeId);
}

export function findNode(graph: Graph, nodeId: string): AgentNode | undefined {
  return graph.nodes.find((node) => node.id === nodeId);
}

export function entryNodes(graph: Graph): AgentNode[] {
  return graph.nodes.filter((node) => incomingEdges(graph, node.id).length === 0);
}

export function hasIncomingEdges(graph: Graph, nodeId: string): boolean {
  return graph.edges.some((edge) => edge.target === nodeId);
}

/** True when the node takes every outgoing edge rather than choosing one. */
export function routesToAll(graph: Graph, node: AgentNode): boolean {
  return node.fanout === 'parallel' || outgoingEdges(graph, node.id).length <= 1;
}

/** Branch names a node may route to. Empty for parallel and single-edge nodes. */
export function branchNames(graph: Graph, nodeId: string): string[] {
  const node = findNode(graph, nodeId);
  if (!node || routesToAll(graph, node)) {
    return [];
  }
  return outgoingEdges(graph, nodeId).map((edge) => edge.branch ?? '');
}

/** Distinct source ids of a node's incoming edges, in edge order. */
export function predecessorIds(graph: Graph, nodeId: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const edge of incomingEdges(graph, nodeId)) {
    if (!seen.has(edge.source)) {
      seen.add(edge.source);
      ids.push(edge.source);
    }
  }
  return ids;
}

/** Every node that can reach `nodeId`, following edges backwards. */
export function ancestors(graph: Graph, nodeId: string): Set<string> {
  const seen = new Set<string>();
  const queue = predecessorIds(graph, nodeId);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);
    queue.push(...predecessorIds(graph, current));
  }
  return seen;
}

export interface Handoff {
  name: string;
  condition: string;
}

/** Every outgoing handoff with its branch name and condition, for the system prompt. */
export function handoffs(graph: Graph, nodeId: string): Handoff[] {
  return outgoingEdges(graph, nodeId).map((edge) => ({
    name: (edge.branch ?? '').trim(),
    condition: (edge.condition ?? '').trim(),
  }));
}
