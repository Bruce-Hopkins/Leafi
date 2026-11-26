import { progressLine, type RunNotificationParams } from '../mcp/run-notifications';

/** The slice of Pi's UI the watcher draws on. */
export interface WatchUi {
  setStatus(key: string, text: string | undefined): void;
  setWidget(key: string, content: string[] | undefined): void;
  notify(message: string, type?: 'info' | 'warning' | 'error'): void;
}

/** Puts a message in the conversation; `triggerTurn` wakes the model when it is idle. */
export type SendMessage = (
  message: { customType: string; content: string; display: boolean; details?: unknown },
  options: { triggerTurn: boolean; deliverAs: 'followUp' },
) => void;

interface RunState {
  lines: string[];
  settled?: Extract<RunNotificationParams, { kind: 'settled' }>;
  ui?: WatchUi;
}

const WIDGET_LINES = 6;
/** Runs nobody watched, kept a little while in case `watch` comes after they settled. */
const MAX_UNWATCHED = 20;
export const STATUS_KEY = 'leafi';
export const MESSAGE_TYPE = 'leafi-run';

/**
 * Draws the runs this session started from the server's pushes, as they
 * arrive, and tells the model once when each finishes. Progress never reaches
 * the model; only the one "finished" message does.
 */
export class RunWatcher {
  private readonly runs = new Map<string, RunState>();
  /** Runs a `leafi_wait_run` call is waiting on: that call reports the end, so no message is sent. */
  private readonly waiting = new Map<string, number>();

  constructor(private readonly send: SendMessage) {}

  /** Starts drawing a run in this UI. The run may already have moved, or ended. */
  watch(runId: string, ui: WatchUi): void {
    const state = this.state(runId);
    state.ui = ui;
    if (state.settled) {
      this.finish(runId, state);
    } else {
      this.draw(runId, state);
    }
  }

  /** Marks a run as waited on for the duration of `work`. */
  async waitingOn<T>(runId: string, work: () => Promise<T>): Promise<T> {
    this.waiting.set(runId, (this.waiting.get(runId) ?? 0) + 1);
    try {
      return await work();
    } finally {
      const left = (this.waiting.get(runId) ?? 1) - 1;
      if (left > 0) {
        this.waiting.set(runId, left);
      } else {
        this.waiting.delete(runId);
      }
    }
  }

  handle(params: RunNotificationParams): void {
    const state = this.state(params.runId);
    if (params.kind === 'event') {
      state.lines.push(progressLine(params.event));
      state.lines.splice(0, Math.max(0, state.lines.length - WIDGET_LINES));
      this.draw(params.runId, state);
      return;
    }
    state.settled = params;
    if (state.ui) {
      this.finish(params.runId, state);
    } else {
      this.prune();
    }
  }

  /** Clears everything drawn, for session shutdown. */
  clear(): void {
    for (const [runId, state] of this.runs) {
      state.ui?.setWidget(widgetKey(runId), undefined);
      state.ui?.setStatus(STATUS_KEY, undefined);
    }
    this.runs.clear();
  }

  private finish(runId: string, state: RunState): void {
    const settled = state.settled;
    const ui = state.ui;
    if (!settled || !ui) {
      return;
    }
    this.runs.delete(runId);
    ui.setWidget(widgetKey(runId), undefined);
    ui.setStatus(STATUS_KEY, undefined);
    const cost = settled.costUsd !== undefined ? ` ($${settled.costUsd.toFixed(4)})` : '';
    ui.notify(`leafi run ${short(runId)} ${settled.status}${cost}`, settled.status === 'completed' ? 'info' : 'warning');
    if (this.waiting.has(runId)) {
      return;
    }
    // Only runtime-written facts: node output and error text come through leafi_get_run, as a tool result.
    this.send(
      {
        customType: MESSAGE_TYPE,
        content:
          `The leafi run ${runId} has finished with status "${settled.status}"${cost}. ` +
          `Call leafi_get_run with runId "${runId}" and report the result as the leafi skill describes` +
          (settled.status === 'completed' ? '.' : ', including the error it gives.'),
        display: true,
        details: settled,
      },
      { triggerTurn: true, deliverAs: 'followUp' },
    );
  }

  private draw(runId: string, state: RunState): void {
    if (!state.ui || state.lines.length === 0) {
      return;
    }
    state.ui.setStatus(STATUS_KEY, `leafi ${short(runId)}: ${state.lines[state.lines.length - 1]}`);
    state.ui.setWidget(widgetKey(runId), [`leafi run ${short(runId)}`, ...state.lines.map((line) => `  ${line}`)]);
  }

  private state(runId: string): RunState {
    let state = this.runs.get(runId);
    if (!state) {
      state = { lines: [] };
      this.runs.set(runId, state);
    }
    return state;
  }

  private prune(): void {
    const unwatched = [...this.runs].filter(([, state]) => !state.ui && state.settled);
    for (const [runId] of unwatched.slice(0, Math.max(0, unwatched.length - MAX_UNWATCHED))) {
      this.runs.delete(runId);
    }
  }
}

function widgetKey(runId: string): string {
  return `leafi:${runId}`;
}

function short(runId: string): string {
  return runId.slice(0, 8);
}
