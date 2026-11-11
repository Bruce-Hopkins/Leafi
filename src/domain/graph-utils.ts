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

/** An edge with a limit: the only kind that may close a cycle (recursion). */
export function isLoopEdge(edge: GraphEdge): boolean {
  return edge.maxTraversals !== undefined;
}

/** Incoming edges that gate a node's first run. Loop edges re-trigger it instead. */
export function forwardIncoming(graph: Graph, nodeId: string): GraphEdge[] {
  return incomingEdges(graph, nodeId).filter((edge) => !isLoopEdge(edge));
}

export function entryNodes(graph: Graph): AgentNode[] {
  return graph.nodes.filter((node) => forwardIncoming(graph, node.id).length === 0);
}

export function hasIncomingEdges(graph: Graph, nodeId: string): boolean {
  return forwardIncoming(graph, nodeId).length > 0;
}

/**
 * The nodes that run again when `edge` loops back: everything reachable from its
 * target that can also reach its source. Includes both ends.
 */
export function loopRegion(graph: Graph, edge: GraphEdge): Set<string> {
  const reach = (start: string, forward: boolean): Set<string> => {
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const next of graph.edges) {
        const [from, to] = forward ? [next.source, next.target] : [next.target, next.source];
        if (from === current && !seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    return seen;
  };
  const down = reach(edge.target, true);
  const up = reach(edge.source, false);
  return new Set([...down].filter((id) => up.has(id)));
}

/** True when `edge` lies on a cycle, so that taking it can send control back. */
export function closesCycle(graph: Graph, edge: GraphEdge): boolean {
  return reachesFrom(graph, edge.target, edge.source);
}

function reachesFrom(graph: Graph, from: string, to: string): boolean {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === to) {
      return true;
    }
    for (const edge of graph.edges) {
      if (edge.source === current && !seen.has(edge.target)) {
        seen.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return false;
}

/** Nodes that sit inside at least one loop. */
export function loopNodeIds(graph: Graph): Set<string> {
  const ids = new Set<string>();
  for (const edge of graph.edges.filter(isLoopEdge)) {
    for (const id of loopRegion(graph, edge)) {
      ids.add(id);
    }
  }
  return ids;
}

/** Edge traversals left, or undefined for an unlimited edge. */
export function usesLeft(edge: GraphEdge, counts: Record<string, number> | undefined): number | undefined {
  return edge.maxTraversals === undefined ? undefined : Math.max(0, edge.maxTraversals - (counts?.[edge.id] ?? 0));
}

/** True when the node takes every outgoing edge rather than choosing one. */
export function routesToAll(graph: Graph, node: AgentNode): boolean {
  return node.fanout === 'parallel' || outgoingEdges(graph, node.id).length <= 1;
}

/** Branch names a node may route to. Empty for parallel and single-edge nodes. */
export function branchNames(graph: Graph, nodeId: string, counts?: Record<string, number>): string[] {
  const node = findNode(graph, nodeId);
  if (!node || routesToAll(graph, node)) {
    return [];
  }
  return outgoingEdges(graph, nodeId)
    .filter((edge) => usesLeft(edge, counts) !== 0)
    .map((edge) => edge.branch ?? '');
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
  /** Traversals left on a limited edge; absent when the edge is unlimited. */
  usesLeft?: number;
}

/** Every outgoing handoff with its branch name and condition, for the system prompt. */
export function handoffs(graph: Graph, nodeId: string, counts?: Record<string, number>): Handoff[] {
  return outgoingEdges(graph, nodeId).map((edge) => {
    const left = usesLeft(edge, counts);
    return {
      name: (edge.branch ?? '').trim(),
      condition: (edge.condition ?? '').trim(),
      ...(left !== undefined ? { usesLeft: left } : {}),
    };
  });
}
