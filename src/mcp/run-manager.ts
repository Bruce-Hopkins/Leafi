import type { RunService } from '../app/run-service';
import type { Graph, Run, RunEvent } from '../domain/types';
import type { RunStore } from '../runtime/run-store';
import type { McpContext } from './context';
import { assertFlowAllowed, PolicyError, type AllowSetting } from './policy';

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
      });
    } finally {
      this.starting -= 1;
    }

    const entry: ActiveRun = { run: started.run, controller, done: started.done };
    this.active.set(started.run.id, entry);
    void started.done
      .catch(() => undefined)
      .finally(() => {
        if (this.active.get(started.run.id) === entry) {
          this.active.delete(started.run.id);
        }
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
