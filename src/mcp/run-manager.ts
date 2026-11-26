import type { RunService } from '../app/run-service';
import type { Graph, Run, RunEvent } from '../domain/types';
import type { RunStore } from '../runtime/run-store';
import type { McpContext } from './context';
import { assertFlowAllowed, PolicyError, type AllowSetting } from './policy';
import { RunFeed } from './run-feed';

/** What ends a `wait`: the run settling, a node finishing, or any event at all. */
export type WaitUntil = 'done' | 'node' | 'event';

export interface WaitOptions {
  /** Report events from this sequence number on. */
  afterSeq: number;
  until: WaitUntil;
  timeoutMs: number;
  /** The caller gave up: the wait ends, the run does not. */
  signal?: AbortSignal;
  /** Each event read, as it is read. */
  onEvent?(event: RunEvent, label: string | undefined): void;
}

export interface WaitResult {
  run: Run;
  /** The run is no longer running. */
  finished: boolean;
  /** The wait ran out before its condition was met; call again from `nextSeq`. */
  timedOut: boolean;
  /** Pass this as `afterSeq` next time: nothing is shown twice or skipped. */
  nextSeq: number;
  events: RunEvent[];
  /** Node id to label, for every node that has started so far. */
  labels: Record<string, string>;
  note?: string;
}

const NODE_SETTLED = new Set(['node_completed', 'node_failed', 'node_skipped']);

interface ActiveRun {
  run: Run;
  controller: AbortController;
  done: Promise<Run>;
}

/**
 * In-flight MCP runs. A run's artifacts are persisted, so `get_run` reads the
 * store; this map exists only to expose a still-running object and to cancel it.
 */
export class RunManager {
  private readonly active = new Map<string, ActiveRun>();
  /** Starts past the limit check but not yet in `active`. */
  private starting = 0;
  /** Wakes waiters and plugins the moment a run records an event or settles. */
  readonly feed = new RunFeed();

  constructor(
    private readonly runs: RunService,
    private readonly store: RunStore,
    private readonly policy: McpContext['policy'],
  ) {}

  /** `granted` holds the permissions the person allowed for this run only. */
  async start(graph: Graph, input: string, granted?: ReadonlySet<AllowSetting>): Promise<Run> {
    // The slot is taken before the first await: pre-flight can take seconds, and
    // every start_run that arrives meanwhile must see it as spent.
    const running = this.active.size + this.starting;
    if (running >= this.policy.maxConcurrentRuns) {
      throw new PolicyError(
        `The MCP server is already running ${running} flow(s); its limit is ${this.policy.maxConcurrentRuns}.`,
      );
    }
    assertFlowAllowed(graph, this.policy, granted);
    this.starting += 1;

    const controller = new AbortController();
    let started: Awaited<ReturnType<RunService['start']>>;
    try {
      started = await this.runs.start(graph, input, {
        save: true,
        source: 'mcp',
        signal: controller.signal,
        // Called after each event is written to the log, so a woken reader finds it there.
        onEvent: (event) => this.feed.publish(event),
      });
    } finally {
      this.starting -= 1;
    }

    const entry: ActiveRun = { run: started.run, controller, done: started.done };
    this.active.set(started.run.id, entry);
    this.feed.begin(started.run.id);
    void started.done
      .catch(() => undefined)
      .finally(() => {
        if (this.active.get(started.run.id) === entry) {
          this.active.delete(started.run.id);
        }
        // `done` resolves after the executor stores the final record, so a woken waiter reads it whole.
        this.feed.settle(started.run);
      });

    return started.run;
  }

  async get(runId: string): Promise<Run | null> {
    return this.active.get(runId)?.run ?? this.store.readRun(runId);
  }

  async list(limit: number): Promise<Run[]> {
    const stored = await this.runs.listRuns();
    // A run left `running` by a dead process is not this process's run.
    const visible = stored.filter((run) => run.status !== 'running' || this.active.has(run.id));
    for (const active of this.active.values()) {
      if (!visible.some((run) => run.id === active.run.id)) {
        visible.push(active.run);
      }
    }
    return visible.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
  }

  async events(runId: string, afterSeq: number): Promise<RunEvent[]> {
    const events = await this.store.readEvents(runId);
    return events.filter((event) => event.seq >= afterSeq);
  }

  /**
   * Holds until the run meets `until`, the timeout passes or the caller aborts.
   * Nothing here sleeps for a fixed time: each pass waits on the feed, which
   * only resolves when the run records an event or settles. Returns null for a
   * run that does not exist.
   */
  async wait(runId: string, options: WaitOptions): Promise<WaitResult | null> {
    if (!(await this.get(runId))) {
      return null;
    }
    const deadline = Date.now() + options.timeoutMs;
    const events: RunEvent[] = [];
    let nextSeq = options.afterSeq;
    let labels: Record<string, string> = {};

    for (;;) {
      const tick = this.feed.next(runId); // before the read: see RunFeed.next
      const open = this.feed.isOpen(runId);
      const log = await this.store.readEvents(runId);
      labels = labelsOf(log);
      let met = false;
      for (const event of log) {
        if (event.seq < nextSeq) {
          continue;
        }
        events.push(event);
        nextSeq = event.seq + 1;
        options.onEvent?.(event, event.nodeId ? labels[event.nodeId] : undefined);
        met ||= options.until === 'event' || (options.until === 'node' && NODE_SETTLED.has(event.type));
      }

      if (!open || met) {
        tick.cancel();
        return this.waitResult(runId, { events, nextSeq, labels, timedOut: false });
      }
      const outcome = await race(tick.promise, deadline, options.signal);
      tick.cancel();
      if (outcome === 'timeout') {
        return this.waitResult(runId, { events, nextSeq, labels, timedOut: true });
      }
      if (outcome === 'aborted') {
        throw new WaitAborted();
      }
    }
  }

  private async waitResult(
    runId: string,
    found: { events: RunEvent[]; nextSeq: number; labels: Record<string, string>; timedOut: boolean },
  ): Promise<WaitResult> {
    const run = (await this.get(runId)) as Run;
    const finished = run.status !== 'running';
    // Stored as running, but this server is not running it: the process that was has stopped.
    const orphaned = !finished && !this.feed.isOpen(runId);
    return {
      run,
      finished,
      ...found,
      ...(orphaned
        ? { note: 'This run is recorded as running, but no server is running it: the process that started it stopped. It will not finish.' }
        : {}),
    };
  }

  cancel(runId: string): boolean {
    const active = this.active.get(runId);
    if (!active) {
      return false;
    }
    active.controller.abort();
    return true;
  }

  async shutdown(): Promise<void> {
    const entries = [...this.active.values()];
    for (const entry of entries) {
      entry.controller.abort();
    }
    await Promise.allSettled(entries.map((entry) => entry.done));
  }
}

/** The caller stopped waiting; the run goes on. */
export class WaitAborted extends Error {
  constructor() {
    super('Stopped waiting. The run is still going; cancel it with cancel_run.');
    this.name = 'WaitAborted';
  }
}

function labelsOf(events: readonly RunEvent[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const event of events) {
    const label = event.payload.label;
    if (event.nodeId && typeof label === 'string') {
      labels[event.nodeId] = label;
    }
  }
  return labels;
}

/** Whichever comes first: the run changing, the deadline, or the caller giving up. */
function race(tick: Promise<void>, deadline: number, signal: AbortSignal | undefined): Promise<'tick' | 'timeout' | 'aborted'> {
  if (signal?.aborted) {
    return Promise.resolve('aborted');
  }
  return new Promise((resolve) => {
    const finish = (outcome: 'tick' | 'timeout' | 'aborted'): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const onAbort = (): void => finish('aborted');
    const timer = setTimeout(() => finish('timeout'), Math.max(0, deadline - Date.now()));
    signal?.addEventListener('abort', onAbort, { once: true });
    void tick.then(() => finish('tick'));
  });
}
