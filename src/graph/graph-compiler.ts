import { END, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph';
import { incomingEdges, outgoingEdges, predecessorIds } from '../domain/graph-utils';
import type { AgentNode, Graph } from '../domain/types';
import { takenIncoming, takenOutgoing } from './routing';
import { RunStateAnnotation, type RunState } from './run-state';

/**
 * `StateGraph` otherwise defaults its node-name generic to `typeof START`, which
 * rejects dynamic node ids. Node ids are uuids decided at runtime, so the name
 * type is plain `string`.
 */
type RunStateGraph = StateGraph<typeof RunStateAnnotation, RunState, Partial<RunState>, string>;

function createRunStateGraph(): RunStateGraph {
  return new StateGraph<typeof RunStateAnnotation, RunState, Partial<RunState>, string>(RunStateAnnotation);
}

export interface NodeResult {
  output: string;
  next?: string;
  /** The node hit its iteration limit and handed over what it had. */
  stoppedEarly?: boolean;
  /** Background jobs still running when the node finished, handed to its successors. */
  jobs?: string[];
}

/** The bits of node execution the compiled graph delegates to the run executor. */
export interface GraphRuntime {
  runNode(node: AgentNode, state: RunState, signal: AbortSignal): Promise<NodeResult>;
  onEdgeTaken(sourceId: string, targetId: string, branch?: string): Promise<void>;
  onNodeSkipped(node: AgentNode): Promise<void>;
}

/**
 * Compiles a validated graph into a LangGraph `StateGraph` in memory. Every edge
 * is a static edge and every node executes exactly once — its agent loop, or a
 * no-op that records a skip — so a join's waiting edge always fills. Routing
 * between a node's successors lives in `routing.ts`.
 */
export function compileGraph(graph: Graph, runtime: GraphRuntime, signal: AbortSignal) {
  const builder = createRunStateGraph();

  for (const node of graph.nodes) {
    builder.addNode(node.id, async (state: RunState, config: LangGraphRunnableConfig) => {
      const isEntry = incomingEdges(graph, node.id).length === 0;
      if (!isEntry && takenIncoming(graph, node.id, state).length === 0) {
        await runtime.onNodeSkipped(node);
        return { skipped: { [node.id]: true as const } };
      }

      // config.signal also carries LangGraph's sibling-failure abort.
      const nodeSignal = config.signal ? AbortSignal.any([signal, config.signal]) : signal;
      const result = await runtime.runNode(node, state, nodeSignal);

      for (const edge of takenOutgoing(graph, node, result.next)) {
        await runtime.onEdgeTaken(node.id, edge.target, edge.branch);
      }

      return {
        outputs: { [node.id]: result.output },
        ...(result.next ? { branches: { [node.id]: result.next } } : {}),
        ...(result.stoppedEarly ? { stoppedEarly: { [node.id]: true as const } } : {}),
        ...(result.jobs && result.jobs.length > 0 ? { jobs: { [node.id]: result.jobs } } : {}),
      };
    });
  }

  for (const node of graph.nodes) {
    const sources = predecessorIds(graph, node.id);
    if (sources.length === 0) {
      builder.addEdge(START, node.id);
    } else if (sources.length === 1) {
      const source = sources[0];
      if (source) {
        builder.addEdge(source, node.id);
      }
    } else {
      builder.addEdge(sources, node.id);
    }

    if (outgoingEdges(graph, node.id).length === 0) {
      builder.addEdge(node.id, END);
    }
  }

  return builder.compile();
}
