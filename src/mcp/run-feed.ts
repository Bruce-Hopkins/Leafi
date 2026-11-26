import type { Run, RunEvent } from '../domain/types';

/** Told about every event of every run this server is running, and once more when each run settles. */
export interface RunFeedListener {
  event?(event: RunEvent): void;
  settled?(run: Run): void;
}

/** A wake-up for one run: `promise` resolves on its next event or when it settles. */
export interface FeedTick {
  promise: Promise<void>;
  /** Stops waiting, so an abandoned tick holds nothing. */
  cancel(): void;
}

/**
 * The in-process signal that a run changed. It carries no event data: an
 * event is written to `events.jsonl` before it is published here, so whoever
 * wakes reads the log and finds it there. That keeps one source of truth and
 * no second copy of the events in memory.
 */
export class RunFeed {
  /** Runs still in flight, each with the wake-ups waiting on it. */
  private readonly open = new Map<string, Set<() => void>>();
  private readonly listeners = new Set<RunFeedListener>();

  /** A run that has started and not yet settled. */
  begin(runId: string): void {
    if (!this.open.has(runId)) {
      this.open.set(runId, new Set());
    }
  }

  isOpen(runId: string): boolean {
    return this.open.has(runId);
  }

  publish(event: RunEvent): void {
    this.wake(event.runId);
    for (const listener of this.listeners) {
      // Called from inside the run's event sink: a listener's failure must never stop the run.
      safely(() => listener.event?.(event));
    }
  }

  /** The run is over and its stored record is final. */
  settle(run: Run): void {
    this.wake(run.id);
    this.open.delete(run.id);
    for (const listener of this.listeners) {
      safely(() => listener.settled?.(run));
    }
  }

  /**
   * Resolves on the next change to the run. Take the tick before reading the
   * log: an event recorded after the tick resolves it, and one recorded before
   * is already in the log, so none falls between the two. A run that is not
   * open resolves at once, since nothing will ever wake it.
   */
  next(runId: string): FeedTick {
    const waiters = this.open.get(runId);
    if (!waiters) {
      return { promise: Promise.resolve(), cancel: () => undefined };
    }
    let wake: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      wake = resolve;
    });
    waiters.add(wake);
    return { promise, cancel: () => waiters.delete(wake) };
  }

  subscribe(listener: RunFeedListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** How many wake-ups are pending on a run, for tests. */
  waiting(runId: string): number {
    return this.open.get(runId)?.size ?? 0;
  }

  private wake(runId: string): void {
    const waiters = this.open.get(runId);
    if (!waiters) {
      return;
    }
    const pending = [...waiters];
    waiters.clear();
    for (const resolve of pending) {
      resolve();
    }
  }
}

function safely(call: () => void): void {
  try {
    call();
  } catch {
    // A listener is a convenience, such as a push to a plugin; the run does not depend on it.
  }
}
