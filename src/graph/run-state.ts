import { Annotation } from '@langchain/langgraph';

const merge = <T>(current: Record<string, T>, next: Record<string, T>): Record<string, T> => ({
  ...current,
  ...next,
});

/** The LangGraph state threaded through one run. */
export const RunStateAnnotation = Annotation.Root({
  input: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => '',
  }),
  /** Output of every node that ran. Each node writes only its own key. */
  outputs: Annotation<Record<string, string>>({
    reducer: merge,
    default: () => ({}),
  }),
  /** The branch each branching node chose, keyed by node id. */
  branches: Annotation<Record<string, string>>({
    reducer: merge,
    default: () => ({}),
  }),
  /** Nodes that hit their iteration limit and handed over a partial result. */
  stoppedEarly: Annotation<Record<string, true>>({
    reducer: merge,
    default: () => ({}),
  }),
  /** Background jobs each node handed on: those still running when it finished. */
  jobs: Annotation<Record<string, string[]>>({
    reducer: merge,
    default: () => ({}),
  }),
  /** Nodes skipped because no incoming edge was taken. */
  skipped: Annotation<Record<string, true>>({
    reducer: merge,
    default: () => ({}),
  }),
});

export type RunState = typeof RunStateAnnotation.State;
