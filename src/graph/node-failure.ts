/** A failure attributable to one node, reported as a `run_failed` event. */
export class NodeFailureError extends Error {
  constructor(
    message: string,
    readonly nodeId?: string,
  ) {
    super(message);
    this.name = 'NodeFailureError';
  }
}

/** LangGraph wraps node errors, so unwrap the cause chain looking for ours. */
export function findNodeFailure(error: unknown): NodeFailureError | null {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (current instanceof NodeFailureError) {
      return current;
    }
    if (current instanceof AggregateError) {
      for (const nested of current.errors) {
        const failure = findNodeFailure(nested);
        if (failure) {
          return nestedCount(current.errors) > 1 ? withOthers(failure, current.errors.length) : failure;
        }
      }
    }
    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

function nestedCount(errors: readonly unknown[]): number {
  return errors.length;
}

function withOthers(failure: NodeFailureError, total: number): NodeFailureError {
  return new NodeFailureError(`${failure.message} and ${total - 1} other node(s) failed.`, failure.nodeId);
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
