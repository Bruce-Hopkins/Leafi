import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface WaitDeps {
  call(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  sleep(ms: number, signal: AbortSignal | undefined): Promise<void>;
}

export interface WaitOptions {
  runId: string;
  /** Returns "still running" after this long, so the model can wait again. */
  maxWaitMs: number;
  pollMs: number;
  signal: AbortSignal | undefined;
  onProgress(line: string): void;
}

interface RunView {
  status?: string;
  [key: string]: unknown;
}

interface EventView {
  seq: number;
  type: string;
  nodeId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Polls the run inside the extension, so waiting costs no model calls. Returns
 * the `get_run` result once the run is no longer running, or a short note when
 * `maxWaitMs` passes first. Aborting stops the wait, never the run.
 */
export async function waitForRun(deps: WaitDeps, options: WaitOptions): Promise<{ text: string; finished: boolean; run?: RunView }> {
  const started = Date.now();
  let nextSeq = 0;
  for (;;) {
    const result = await deps.call('get_run', { runId: options.runId });
    const text = textOf(result);
    if (result.isError) {
      throw new Error(text);
    }
    const run = JSON.parse(text) as RunView;
    nextSeq = await report(deps, options, nextSeq);
    if (run.status !== 'running') {
      return { text, finished: true, run };
    }
    if (options.signal?.aborted) {
      throw new Error('Stopped waiting. The run is still going; cancel it with leafi_cancel_run.');
    }
    if (Date.now() - started >= options.maxWaitMs) {
      return {
        text: `Run ${options.runId} is still running after ${Math.round((Date.now() - started) / 1000)}s. Call leafi_wait_run again to keep waiting.`,
        finished: false,
        run,
      };
    }
    await deps.sleep(options.pollMs, options.signal);
  }
}

/** Shows the events from `nextSeq` on and returns the next sequence number not yet shown. */
async function report(deps: WaitDeps, options: WaitOptions, nextSeq: number): Promise<number> {
  const result = await deps.call('get_run_events', { runId: options.runId, afterSeq: nextSeq, limit: 100 });
  if (result.isError) {
    return nextSeq;
  }
  let events: EventView[];
  try {
    events = (JSON.parse(textOf(result)) as { events?: EventView[] }).events ?? [];
  } catch {
    return nextSeq;
  }
  let next = nextSeq;
  for (const event of events) {
    if (event.seq < nextSeq) {
      continue;
    }
    next = Math.max(next, event.seq + 1);
    const line = describe(event);
    if (line) {
      options.onProgress(line);
    }
  }
  return next;
}

function describe(event: EventView): string | undefined {
  const label = typeof event.payload?.label === 'string' ? event.payload.label : event.nodeId;
  switch (event.type) {
    case 'node_started':
      return `▶ ${label}`;
    case 'node_completed':
      return `✔ ${event.nodeId}`;
    case 'node_skipped':
      return `– ${label} (skipped)`;
    case 'node_failed':
      return `✖ ${event.nodeId}: ${String(event.payload?.error ?? 'failed')}`;
    case 'run_completed':
      return 'run completed';
    case 'run_failed':
      return 'run failed';
    case 'run_cancelled':
      return 'run cancelled';
    default:
      return undefined;
  }
}

export function textOf(result: CallToolResult): string {
  return result.content
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join('\n');
}
