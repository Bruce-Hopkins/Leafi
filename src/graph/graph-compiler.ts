import { forwardIncoming, isLoopEdge, loopRegion, outgoingEdges } from '../domain/graph-utils';
import type { AgentNode, Graph, GraphEdge } from '../domain/types';
import { takenOutgoing } from './routing';
import { emptyRunState, type RunState } from './run-state';

export interface NodeResult {
  output: string;
  next?: string;
  /** The node hit its iteration limit and handed over what it had. */
  stoppedEarly?: boolean;
  /** Background jobs still running when the node finished, handed to its successors. */
  jobs?: string[];
}

/** Where a taken limited edge stands, for the event log. */
export interface EdgeUse {
  count: number;
  limit: number;
}

/** The bits of node execution the scheduler delegates to the run executor. */
export interface GraphRuntime {
  runNode(node: AgentNode, state: RunState, signal: AbortSignal): Promise<NodeResult>;
  onEdgeTaken(sourceId: string, targetId: string, branch?: string, use?: EdgeUse): Promise<void>;
  onNodeSkipped(node: AgentNode): Promise<void>;
}

export interface RunGraphOptions {
  input: string;
  /** Nodes that may run at once. */
  maxConcurrency: number;
}

type Status = 'pending' | 'running' | 'done';
type Settled = { id: string; result: NodeResult } | { id: string; error: unknown };

/**
 * Runs a validated graph to completion and returns the final state.
 *
 * Unlimited edges form a DAG with the usual rules: a node waits for all of its
 * incoming edges, runs once if at least one was taken, and is recorded as
 * skipped otherwise. A *limited* edge (`maxTraversals`) is how a flow recurses:
 * when a node takes one, the nodes of its loop run again from the edge's target,
 * with the node's other edges held back until the loop ends. Once the limit is
 * used up the edge is no longer taken, which forces the node down another edge.
 * Routing between a node's successors lives in `routing.ts`.
 */
export async function runGraph(
  graph: Graph,
  runtime: GraphRuntime,
  signal: AbortSignal,
  options: RunGraphOptions,
): Promise<RunState> {
  const state = emptyRunState(options.input);
  const status = new Map<string, Status>(graph.nodes.map((node) => [node.id, 'pending']));
  /** Resolution of each unlimited edge for the node's current pass. */
  const resolved = new Map<string, 'taken' | 'dead'>();
  /** Nodes sent back to by a limited edge: they run again whatever their other edges say. */
  const triggered = new Set<string>();
  const running = new Map<string, Promise<Settled>>();
  const internal = new AbortController();
  const nodeSignal = AbortSignal.any([signal, internal.signal]);
  let failure: { error: unknown } | undefined;

  const ready = (node: AgentNode): boolean =>
    triggered.has(node.id) || forwardIncoming(graph, node.id).every((edge) => resolved.has(edge.id));

  const resolve = (edge: GraphEdge, value: 'taken' | 'dead'): void => {
    // A node outside the loop that already ran is not run again.
    if (status.get(edge.target) === 'pending') {
      resolved.set(edge.id, value);
    }
  };

  const skip = async (node: AgentNode): Promise<void> => {
    status.set(node.id, 'done');
    state.skipped[node.id] = true;
    await runtime.onNodeSkipped(node);
    for (const edge of outgoingEdges(graph, node.id)) {
      if (!isLoopEdge(edge)) {
        resolve(edge, 'dead');
      }
    }
  };

  const launch = (node: AgentNode): void => {
    status.set(node.id, 'running');
    triggered.delete(node.id);
    state.passes[node.id] = (state.passes[node.id] ?? 0) + 1;
    const snapshot = structuredClone(state);
    running.set(
      node.id,
      runtime.runNode(node, snapshot, nodeSignal).then(
        (result): Settled => ({ id: node.id, result }),
        (error: unknown): Settled => ({ id: node.id, error }),
      ),
    );
  };

  const pump = async (): Promise<void> => {
    let progressed = true;
    while (progressed && !failure) {
      progressed = false;
      for (const node of graph.nodes) {
        if (status.get(node.id) !== 'pending' || !ready(node)) {
          continue;
        }
        const incoming = forwardIncoming(graph, node.id);
        const isEntry = incoming.length === 0;
        if (!isEntry && !triggered.has(node.id) && !incoming.some((edge) => resolved.get(edge.id) === 'taken')) {
          await skip(node);
          progressed = true;
        } else if (running.size < options.maxConcurrency) {
          launch(node);
          progressed = true;
        }
      }
    }
  };

  /** Sends control back along a limited edge: its loop runs again from the target. */
  const loopBack = (edge: GraphEdge): void => {
    const region = loopRegion(graph, edge);
    for (const id of region) {
      status.set(id, 'pending');
      delete state.branches[id];
      delete state.skipped[id];
      for (const incoming of forwardIncoming(graph, id)) {
        if (region.has(incoming.source)) {
          resolved.delete(incoming.id);
        }
      }
    }
    triggered.add(edge.target);
  };

  const complete = async (node: AgentNode, result: NodeResult): Promise<void> => {
    status.set(node.id, 'done');
    state.outputs[node.id] = result.output;
    setOrClear(state.branches, node.id, result.next);
    setOrClear(state.stoppedEarly, node.id, result.stoppedEarly ? true : undefined);
    setOrClear(state.jobs, node.id, result.jobs && result.jobs.length > 0 ? result.jobs : undefined);

    const taken = takenOutgoing(graph, node, result.next, state.edgeCounts);
    const loops = taken.filter(isLoopEdge);

    for (const edge of loops) {
      const count = (state.edgeCounts[edge.id] ?? 0) + 1;
      state.edgeCounts[edge.id] = count;
      await runtime.onEdgeTaken(node.id, edge.target, edge.branch, { count, limit: edge.maxTraversals ?? count });
      loopBack(edge);
    }
    if (loops.length > 0) {
      // The node's other edges wait until its loop is finished.
      return;
    }

    for (const edge of outgoingEdges(graph, node.id)) {
      if (isLoopEdge(edge)) {
        continue;
      }
      if (taken.includes(edge)) {
        await runtime.onEdgeTaken(node.id, edge.target, edge.branch);
        resolve(edge, 'taken');
      } else {
        resolve(edge, 'dead');
      }
    }
  };

  await pump();
  while (running.size > 0) {
    const settled = await Promise.race(running.values());
    running.delete(settled.id);
    const node = graph.nodes.find((candidate) => candidate.id === settled.id);
    if (!node) {
      continue;
    }
    if ('error' in settled) {
      failure ??= { error: settled.error };
      // Let the siblings unwind: LangGraph used to abort them the same way.
      internal.abort();
      continue;
    }
    if (!failure) {
      await complete(node, settled.result);
      await pump();
    }
  }

  if (failure) {
    throw failure.error;
  }
  return state;
}

function setOrClear<T>(record: Record<string, T>, key: string, value: T | undefined): void {
  if (value === undefined) {
    delete record[key];
  } else {
    record[key] = value;
  }
}
