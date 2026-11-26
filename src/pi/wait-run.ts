import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface WaitDeps {
  /** Calls a server tool; `onProgress` gets each progress message the server sends for the call. */
  call(name: string, args: Record<string, unknown>, extra: { timeoutMs: number; onProgress(message: string): void }): Promise<CallToolResult>;
}

export interface WaitOptions {
  runId: string;
  /** Returns "still running" after this long, so the model can wait again. */
  maxWaitMs: number;
  signal: AbortSignal | undefined;
  onProgress(line: string): void;
}

interface RunView {
  status?: string;
  [key: string]: unknown;
}

/** How long past the server's own wait the client lets the call run. */
const CLIENT_GRACE_MS = 30_000;
const MAX_WAIT_SECONDS = 1800;
const KEEPALIVE = 'still running';

/**
 * One `wait_run` call, held open by the server until the run finishes: no
 * timer and no polling here. The server's progress notifications arrive as the
 * run moves and restart the call's timeout. Returns the run exactly as
 * `get_run` does once it finishes, or a short note when `maxWaitMs` passes first.
 * Aborting stops the wait, never the run.
 */
export async function waitForRun(deps: WaitDeps, options: WaitOptions): Promise<{ text: string; finished: boolean; run?: RunView }> {
  const seconds = Math.min(MAX_WAIT_SECONDS, Math.max(1, Math.ceil(options.maxWaitMs / 1000)));
  let result: CallToolResult;
  try {
    result = await deps.call(
      'wait_run',
      { runId: options.runId, until: 'done', timeoutSeconds: seconds },
      {
        timeoutMs: seconds * 1000 + CLIENT_GRACE_MS,
        onProgress: (message) => {
          if (message && message !== KEEPALIVE) {
            options.onProgress(message);
          }
        },
      },
    );
  } catch (error) {
    if (options.signal?.aborted) {
      throw new Error('Stopped waiting. The run is still going; cancel it with leafi_cancel_run.');
    }
    throw error;
  }
  const text = textOf(result);
  if (result.isError) {
    throw new Error(text);
  }
  const body = JSON.parse(text) as { finished?: boolean; run?: RunView; nextSeq?: number; note?: string };
  if (body.finished) {
    return { text: JSON.stringify(body.run, null, 2), finished: true, ...(body.run ? { run: body.run } : {}) };
  }
  const note = body.note ?? `Run ${options.runId} is still running after ${seconds}s. Call leafi_wait_run again to keep waiting.`;
  return { text: note, finished: false, ...(body.run ? { run: body.run } : {}) };
}

export function textOf(result: CallToolResult): string {
  return result.content
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join('\n');
}
