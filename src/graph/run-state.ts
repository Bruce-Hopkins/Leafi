/**
 * The state threaded through one run. Plain data: the scheduler in
 * `graph-compiler.ts` owns it and hands a snapshot to each node.
 */
export interface RunState {
  input: string;
  /** Latest output of every node that ran; a node that runs again replaces its own. */
  outputs: Record<string, string>;
  /** The branch each branching node chose on its latest pass, keyed by node id. */
  branches: Record<string, string>;
  /** Nodes that hit their iteration limit and handed over a partial result. */
  stoppedEarly: Record<string, true>;
  /** Background jobs each node handed on: those still running when it finished. */
  jobs: Record<string, string[]>;
  /** Nodes skipped because no incoming edge was taken (on their latest pass). */
  skipped: Record<string, true>;
  /** How many times each limited edge has been taken, by edge id. */
  edgeCounts: Record<string, number>;
  /** How many times each node has started, by node id (1 on its first run). */
  passes: Record<string, number>;
}

export function emptyRunState(input: string): RunState {
  return { input, outputs: {}, branches: {}, stoppedEarly: {}, jobs: {}, skipped: {}, edgeCounts: {}, passes: {} };
}
