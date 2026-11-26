import { z } from 'zod';
import type { McpContext } from '../context';
import { WaitAborted } from '../run-manager';
import { isMilestone, progressLine, summarize } from '../run-notifications';
import type { ToolCall, ToolDefinition } from './types';

/** The longest one call may hold, whatever it asks for. */
const MAX_WAIT_SECONDS = 1800;
/** While nothing happens, a client with a progress token hears from the server this often. */
export const KEEPALIVE_MS = 20_000;

const inputSchema = z.object({
  runId: z.string().min(1),
  afterSeq: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Report events from this sequence number on: pass the previous call\'s "nextSeq". Default 0.'),
  until: z
    .enum(['done', 'node', 'event'])
    .optional()
    .describe('"done" (default): return when the run finishes. "node": also return each time a node finishes, fails or is skipped.'),
  timeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(MAX_WAIT_SECONDS)
    .optional()
    .describe('Return "still running" after this long. The server default stays below the usual 60 s client limit.'),
});

export const waitRunTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name: 'wait_run',
  description:
    'Wait for a run and return the moment it finishes (or, with until: "node", the moment a node finishes). ' +
    'Call it right after start_run instead of polling get_run: the call is held open and answered as soon as the run changes, so waiting costs one call, not one per check. ' +
    'The result has "finished", the run exactly as get_run returns it, the milestones since "afterSeq", and "nextSeq". ' +
    'If "timedOut" is true the run is still going: call wait_run again with afterSeq set to "nextSeq".',
  inputSchema,
  annotations: { readOnlyHint: true },
  async handle(input, context: McpContext, call: ToolCall) {
    const until = input.until ?? 'done';
    const timeoutMs = (input.timeoutSeconds ?? context.config.mcpWaitSeconds) * 1000;
    const stopKeepalive = keepalive(call);

    let result;
    try {
      result = await context.runManager.wait(input.runId, {
        afterSeq: input.afterSeq ?? 0,
        until,
        timeoutMs,
        signal: call.signal,
        onEvent: (event, label) => {
          if (call.progress && isMilestone(event)) {
            void call.progress(progressLine(summarize(event, label))).catch(() => undefined);
          }
        },
      });
    } catch (error) {
      if (error instanceof WaitAborted) {
        return context.results.error(error.message);
      }
      throw error;
    } finally {
      stopKeepalive();
    }

    if (!result) {
      return context.results.error(`No run with id "${input.runId}".`);
    }
    const shown = until === 'event' ? result.events : result.events.filter(isMilestone);
    return context.results.json({
      finished: result.finished,
      timedOut: result.timedOut,
      nextSeq: result.nextSeq,
      events: shown.map((event) => summarize(event, event.nodeId ? result.labels[event.nodeId] : undefined)),
      ...(result.note ? { note: result.note } : {}),
      ...(result.timedOut ? { next: `Still running. Call wait_run again with afterSeq ${result.nextSeq}.` } : {}),
      run: result.run,
    });
  },
};

/** A quiet node can run for minutes; a progress note keeps a client that resets on progress from timing out. */
function keepalive(call: ToolCall): () => void {
  if (!call.progress) {
    return () => undefined;
  }
  const progress = call.progress;
  const timer = setInterval(() => {
    void progress('still running').catch(() => undefined);
  }, KEEPALIVE_MS);
  timer.unref();
  return () => clearInterval(timer);
}
