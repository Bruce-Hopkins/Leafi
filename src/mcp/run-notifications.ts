import type { Run, RunEvent, RunStatus } from '../domain/types';

/**
 * The client capability a leafi plugin declares to be pushed run progress. A
 * client that declares it is sent `RUN_NOTIFICATION` for each milestone of
 * every run it starts, and `start_run` answers it with `delivery: "plugin"`.
 */
export const RUN_EVENTS_CAPABILITY = 'leafi/run-events';
export const RUN_NOTIFICATION = 'notifications/leafi/run';

/** The events a person following a run cares about; the rest (model calls, tool calls) are detail. */
const MILESTONES = new Set([
  'node_started',
  'node_completed',
  'node_failed',
  'node_skipped',
  'run_completed',
  'run_failed',
  'run_cancelled',
]);

/** One event as `wait_run` and the plugin push report it: written by the runtime, never node output. */
export interface EventSummary {
  seq: number;
  type: string;
  nodeId?: string;
  label?: string;
  pass?: number;
  error?: string;
  stoppedEarly?: boolean;
  at: string;
}

export type RunNotificationParams =
  | { runId: string; kind: 'event'; event: EventSummary }
  | { runId: string; kind: 'settled'; status: RunStatus; costUsd?: number; error?: string; hasPersonOutput: boolean };

export function isMilestone(event: RunEvent): boolean {
  return MILESTONES.has(event.type);
}

export function summarize(event: RunEvent, label: string | undefined): EventSummary {
  const payload = event.payload;
  return {
    seq: event.seq,
    type: event.type,
    ...(event.nodeId ? { nodeId: event.nodeId } : {}),
    ...(label ? { label } : {}),
    ...(typeof payload.pass === 'number' ? { pass: payload.pass } : {}),
    ...(typeof payload.error === 'string' ? { error: payload.error.slice(0, 500) } : {}),
    ...(payload.stoppedEarly === true ? { stoppedEarly: true } : {}),
    at: event.createdAt,
  };
}

export function settledParams(run: Run): RunNotificationParams {
  return {
    runId: run.id,
    kind: 'settled',
    status: run.status,
    ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
    ...(run.error ? { error: run.error.slice(0, 500) } : {}),
    hasPersonOutput: run.personOutput !== undefined,
  };
}

/** One line for a progress bar or status line. */
export function progressLine(event: EventSummary): string {
  const name = event.label ?? event.nodeId ?? '';
  const pass = event.pass ? ` (pass ${event.pass})` : '';
  switch (event.type) {
    case 'node_started':
      return `▶ ${name}${pass}`;
    case 'node_completed':
      return `✔ ${name}${event.stoppedEarly ? ' (ran out of calls)' : ''}`;
    case 'node_skipped':
      return `– ${name} (skipped)`;
    case 'node_failed':
      return `✖ ${name}: ${event.error ?? 'failed'}`;
    case 'run_completed':
      return 'run completed';
    case 'run_failed':
      return `run failed${event.error ? `: ${event.error}` : ''}`;
    case 'run_cancelled':
      return 'run cancelled';
    default:
      return `${event.type}${name ? ` ${name}` : ''}`;
  }
}
