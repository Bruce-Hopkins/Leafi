import type { RuntimeConfig } from '../config/runtime-config';
import type { Graph, Run, RunSource } from '../domain/types';
import type { EmailService } from '../email/email-service';
import type { RunEventListener } from '../runtime/run-events';
import type { RunExecutor } from '../runtime/run-executor';
import type { RunStore } from '../runtime/run-store';
import { preflightGraph } from './preflight';

export interface StartRunOptions {
  save: boolean;
  source: RunSource;
  onEvent?: RunEventListener;
  signal?: AbortSignal;
}

export interface StartedRun {
  run: Run;
  /** Resolves when the run settles; the returned `Run` carries its final state. */
  done: Promise<Run>;
}

/** The one path both the CLI and the MCP adapter use to start a run. */
export class RunService {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly store: RunStore,
    private readonly executor: RunExecutor,
    private readonly email: EmailService,
  ) {}

  async start(graph: Graph, input: string, options: StartRunOptions): Promise<StartedRun> {
    await preflightGraph(graph, this.config, this.email);
    await this.store.ensureLayout();

    const run = this.store.createRun(graph, input, options.source);
    if (options.save) {
      await this.store.writeRun(run);
    }

    const done = this.executor
      .execute(graph, run, input, {
        save: options.save,
        onEvent: options.onEvent,
        signal: options.signal,
      })
      .then(() => run);

    return { run, done };
  }

  async getRun(id: string): Promise<Run | null> {
    return this.store.readRun(id);
  }

  async listRuns(): Promise<Run[]> {
    return this.store.listRuns();
  }

  cancel(runId: string): boolean {
    return this.executor.cancel(runId);
  }
}
