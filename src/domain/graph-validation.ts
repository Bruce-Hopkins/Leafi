import { ancestors, closesCycle, entryNodes, findNode, isLoopEdge } from './graph-utils';
import { findInvalidOutputSchema } from './output-schema';
import { PROVIDER_IDS, type AgentNode, type Graph, type ValidationIssue } from './types';

const REQUIRED_TEXT_FIELDS = ['label', 'model', 'prompt'] as const;

export function validateGraph(graph: Graph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (graph.nodes.length === 0) {
    issues.push({ code: 'empty-graph', message: 'The graph has no nodes.' });
  }

  issues.push(...validateNodes(graph));
  issues.push(...validateEdges(graph));
  issues.push(...validateFanout(graph));
  issues.push(...validateBranchNames(graph));
  issues.push(...validateInputs(graph));
  issues.push(...validateAudience(graph));
  issues.push(...validateEdgeLimits(graph));

  const cycle = findCycle(graph);
  if (cycle) {
    issues.push({
      code: 'cycle',
      message: `The graph contains a cycle: ${cycle.join(' → ')}. A cycle is only allowed when an edge in it has maxTraversals (an edge limit): add one to the edge that loops back, so recursion cannot run away.`,
      nodeId: cycle[0],
    });
  }

  issues.push(...validateEntryAndReachability(graph));
  return issues;
}

export function isValidGraph(graph: Graph): boolean {
  return validateGraph(graph).length === 0;
}

function validateNodes(graph: Graph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  for (const node of graph.nodes) {
    if (seen.has(node.id)) {
      issues.push({ code: 'duplicate-node', message: `Duplicate node id "${node.id}".`, nodeId: node.id });
      continue;
    }
    seen.add(node.id);
    issues.push(...validateNode(node));
  }

  return issues;
}

function validateNode(node: AgentNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const label = node.label.trim() || node.id;

  for (const field of REQUIRED_TEXT_FIELDS) {
    const value = node[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      issues.push({
        code: 'missing-field',
        message: `Node "${label}" is missing its ${field}.`,
        nodeId: node.id,
      });
    }
  }

  if (!PROVIDER_IDS.includes(node.provider)) {
    issues.push({
      code: 'invalid-provider',
      message: `Node "${label}" has unknown provider "${String(node.provider)}".`,
      nodeId: node.id,
    });
  }

  if (node.outputSchema) {
    const problem = findInvalidOutputSchema(node.outputSchema);
    if (problem) {
      issues.push({ code: 'invalid-output-schema', message: `Node "${label}": ${problem}`, nodeId: node.id });
    }
  }

  return issues;
}

function validateEdges(graph: Graph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const seen = new Set<string>();

  for (const edge of graph.edges) {
    if (seen.has(edge.id)) {
      issues.push({ code: 'duplicate-edge', message: `Duplicate edge id "${edge.id}".`, edgeId: edge.id });
      continue;
    }
    seen.add(edge.id);

    for (const endpoint of ['source', 'target'] as const) {
      if (!nodeIds.has(edge[endpoint])) {
        issues.push({
          code: 'unknown-endpoint',
          message: `Edge "${edge.id}" has a dangling ${endpoint} "${edge[endpoint]}".`,
          edgeId: edge.id,
        });
      }
    }

    if (edge.source === edge.target && !isLoopEdge(edge)) {
      issues.push({
        code: 'self-loop',
        message: `Edge "${edge.id}" connects a node to itself without an edge limit. Add maxTraversals to allow bounded recursion.`,
        edgeId: edge.id,
        nodeId: edge.source,
      });
    }
  }

  return issues;
}

function validateFanout(graph: Graph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const node of graph.nodes) {
    if (node.fanout !== undefined && node.fanout !== 'branch' && node.fanout !== 'parallel') {
      issues.push({
        code: 'invalid-fanout',
        message: `Node "${node.label}" has fanout "${String(node.fanout)}"; it must be "branch" or "parallel".`,
        nodeId: node.id,
      });
      continue;
    }
    if (node.fanout !== 'parallel') {
      continue;
    }

    const outgoing = graph.edges.filter((edge) => edge.source === node.id);
    for (const edge of outgoing) {
      if ((edge.branch?.trim() ?? '').length > 0) {
        issues.push({
          code: 'branch-on-parallel',
          message: `Node "${node.label}" runs its outgoing edges in parallel, so edge "${edge.id}" cannot have a branch name.`,
          edgeId: edge.id,
          nodeId: node.id,
        });
      }
    }

    const seen = new Set<string>();
    for (const edge of outgoing) {
      if (seen.has(edge.target)) {
        issues.push({
          code: 'duplicate-edge',
          message: `Parallel node "${node.label}" has more than one edge to "${edge.target}".`,
          edgeId: edge.id,
          nodeId: node.id,
        });
        continue;
      }
      seen.add(edge.target);
    }
  }

  return issues;
}

function validateInputs(graph: Graph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const node of graph.nodes) {
    if (node.inputs === undefined) {
      continue;
    }
    const reachable = ancestors(graph, node.id);
    for (const input of node.inputs) {
      if (input === '$input') {
        continue;
      }
      if (!findNode(graph, input) || !reachable.has(input)) {
        issues.push({
          code: 'unknown-input',
          message: `Node "${node.label}" declares input "${input}", which is not an ancestor of it.`,
          nodeId: node.id,
        });
      }
    }
  }

  return issues;
}

function validateBranchNames(graph: Graph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const node of graph.nodes) {
    const outgoing = graph.edges.filter((edge) => edge.source === node.id);
    if (outgoing.length <= 1 || node.fanout === 'parallel') {
      continue;
    }

    const seen = new Set<string>();
    for (const edge of outgoing) {
      const branch = edge.branch?.trim() ?? '';
      if (branch.length === 0) {
        issues.push({
          code: 'missing-branch',
          message: `Node "${node.label}" has several outgoing edges, so edge "${edge.id}" needs a branch name.`,
          edgeId: edge.id,
          nodeId: node.id,
        });
        continue;
      }
      if (seen.has(branch)) {
        issues.push({
          code: 'duplicate-branch',
          message: `Node "${node.label}" uses the branch name "${branch}" more than once.`,
          edgeId: edge.id,
          nodeId: node.id,
        });
        continue;
      }
      seen.add(branch);

      if ((edge.condition?.trim() ?? '').length === 0) {
        issues.push({
          code: 'missing-condition',
          message: `Branch "${branch}" from "${node.label}" needs a condition describing when to take it.`,
          edgeId: edge.id,
          nodeId: node.id,
        });
      }
    }
  }

  return issues;
}

function validateEdgeLimits(graph: Graph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const edge of graph.edges) {
    if (!isLoopEdge(edge)) {
      continue;
    }
    const limit = edge.maxTraversals;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
      issues.push({
        code: 'invalid-edge-limit',
        message: `Edge "${edge.id}" has maxTraversals ${String(limit)}; it must be a whole number of at least 1.`,
        edgeId: edge.id,
      });
      continue;
    }
    if (!closesCycle(graph, edge)) {
      issues.push({
        code: 'limit-not-recursive',
        message: `Edge "${edge.id}" has maxTraversals but is not part of a cycle, so it can only ever be taken once. Edge limits exist to bound recursion; remove it or loop the edge back.`,
        edgeId: edge.id,
      });
    }
  }

  for (const node of graph.nodes) {
    const outgoing = graph.edges.filter((edge) => edge.source === node.id);
    if (outgoing.length <= 1 || node.fanout === 'parallel') {
      continue;
    }
    if (outgoing.some(isLoopEdge) && outgoing.every(isLoopEdge)) {
      issues.push({
        code: 'no-exit-edge',
        message: `Node "${node.label}" chooses between edges that all have limits, so once they are used up it has no way out. Leave at least one edge without maxTraversals as the exit.`,
        nodeId: node.id,
      });
    }
  }

  return issues;
}

function validateAudience(graph: Graph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const node of graph.nodes) {
    if (node.audience !== 'person') {
      continue;
    }
    const targets = graph.edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => findNode(graph, edge.target)?.label ?? edge.target);
    if (targets.length === 0) {
      continue;
    }
    issues.push({
      code: 'invalid-audience',
      message: `Node "${node.label}" is marked audience "person", but it hands off to "${targets.join('", "')}". audience marks the run's final result; a node with outgoing edges is a handoff.`,
      nodeId: node.id,
    });
  }

  return issues;
}

function validateEntryAndReachability(graph: Graph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const entries = entryNodes(graph);

  if (graph.nodes.length > 0 && entries.length === 0) {
    issues.push({
      code: 'entry-count',
      message: 'A graph needs at least one entry node (no incoming edges); found none.',
    });
    return issues;
  }

  const reachable = new Set<string>();
  for (const entry of entries) {
    for (const id of reachableFrom(graph, entry.id)) {
      reachable.add(id);
    }
  }

  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) {
      issues.push({
        code: 'unreachable',
        message: `Node "${node.label}" cannot be reached from any entry node.`,
        nodeId: node.id,
      });
    }
  }

  issues.push(...validateConnectivity(graph, entries));
  return issues;
}

/** The graph ignoring edge direction must be one component. */
function validateConnectivity(graph: Graph, entries: AgentNode[]): ValidationIssue[] {
  if (graph.nodes.length === 0 || entries.length <= 1) {
    return [];
  }

  const first = componentOf(graph, entries[0]?.id ?? '');
  return graph.nodes
    .filter((node) => !first.has(node.id))
    .map((node) => ({
      code: 'disconnected' as const,
      message: `Node "${node.label}" is not connected to the rest of the graph.`,
      nodeId: node.id,
    }));
}

function componentOf(graph: Graph, startId: string): Set<string> {
  const adjacency = new Map<string, string[]>();
  const link = (from: string, to: string): void => {
    adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
  };
  for (const edge of graph.edges) {
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }

  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

function reachableFrom(graph: Graph, startId: string): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const targets = adjacency.get(edge.source) ?? [];
    targets.push(edge.target);
    adjacency.set(edge.source, targets);
  }

  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  return seen;
}

/** Kahn's algorithm over the unlimited edges: a leftover node means an unbounded cycle. */
function findCycle(graph: Graph): string[] | null {
  const inDegree = new Map<string, number>(graph.nodes.map((node) => [node.id, 0]));
  const adjacency = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (isLoopEdge(edge) || !inDegree.has(edge.source) || !inDegree.has(edge.target)) {
      continue;
    }
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  }

  const queue = [...inDegree.entries()].flatMap(([id, degree]) => (degree === 0 ? [id] : []));
  const order: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    order.push(current);
    for (const next of adjacency.get(current) ?? []) {
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) {
        queue.push(next);
      }
    }
  }

  if (order.length === graph.nodes.length) {
    return null;
  }

  const ordered = new Set(order);
  const stuck = graph.nodes.flatMap((node) => (ordered.has(node.id) ? [] : [node.id]));
  return [...stuck, stuck[0] ?? ''];
}
