import fs from 'node:fs/promises';
import { validateFlow } from '../app/flow-validation';
import { renderFlow } from '../app/flow-renderer';
import { PreflightError } from '../app/preflight';
import type { FlowMinimum } from '../domain/flow-estimate';
import type { Run, RunEvent } from '../domain/types';
import { toEnvelope } from '../runtime/run-events';
import {
  assertFlags,
  assertNoPositionals,
  EXIT,
  GLOBAL_FLAGS,
  readBooleanFlag,
  readOptionalFlag,
  readSaveFlag,
  requireFlag,
  UsageError,
  type ExitCode,
  type ParsedArgs,
} from './args';
import type { CommandContext } from './context';
import { FlowError } from '../app/flow-service';

const EVENT_MODES = ['ndjson', 'pretty', 'none'] as const;
type EventMode = (typeof EVENT_MODES)[number];

export async function runRun(parsed: ParsedArgs, context: CommandContext): Promise<ExitCode> {
  assertFlags(
    parsed,
    ['graph', 'input', 'input-file', 'json', 'events', 'save', 'no-save', 'diagram', 'no-diagram', ...GLOBAL_FLAGS],
  );
  assertNoPositionals(parsed);

  const graph = await context.flows.loadPath(requireFlag(parsed, 'graph'));
  const input = await readRunInput(parsed);
  const machineReadable = readBooleanFlag(parsed, 'json') || !process.stdout.isTTY;
  const eventMode = readEventMode(parsed);
  const save = readSaveFlag(parsed);
  const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));

  const validation = validateFlow(graph, context.config);
  if (!validation.ok) {
    process.stderr.write(`${JSON.stringify({ ok: false, issues: validation.issues })}\n`);
    return EXIT.invalidInput;
  }

  if (shouldDrawDiagram(parsed, eventMode)) {
    process.stderr.write(`${renderFlow(graph, 'ascii')}\n\n`);
  }

  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    const started = await context.runs.start(graph, input, {
      save,
      source: 'cli',
      signal: controller.signal,
      onEvent: (event) => emitEvent(event, eventMode, labels),
    });

    const finished = await started.done;
    emitResult(finished, machineReadable, validation.minimum);
    return finished.status === 'completed' ? EXIT.success : EXIT.runFailed;
  } catch (error) {
    if (error instanceof PreflightError) {
      process.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    throw error;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

function shouldDrawDiagram(parsed: ParsedArgs, mode: EventMode): boolean {
  if (readBooleanFlag(parsed, 'no-diagram')) {
    return false;
  }
  if (readBooleanFlag(parsed, 'diagram')) {
    return true;
  }
  return mode === 'pretty';
}

function emitEvent(event: RunEvent, mode: EventMode, labels: Map<string, string>): void {
  if (mode === 'none') {
    return;
  }
  if (mode === 'ndjson') {
    process.stdout.write(`${JSON.stringify(toEnvelope(event))}\n`);
    return;
  }
  process.stderr.write(`${formatEvent(event, labels)}\n`);
}

function formatEvent(event: RunEvent, labels: Map<string, string>): string {
  const label = nodeLabel(event, labels);
  switch (event.type) {
    case 'node_started':
      return `▶ ${label}`;
    case 'agent_message':
      return `[${label}]\n${indent(String(event.payload.text ?? ''))}`;
    case 'tool_call':
      return `[${label}] ⚙ ${String(event.payload.tool ?? 'tool')} ${JSON.stringify(event.payload.args ?? {})}`;
    case 'output_rejected':
      return `[${label}] ↻ output rejected (attempt ${String(event.payload.attempt ?? '?')}): ${String(
        (event.payload.violations as string[] | undefined)?.join('; ') ?? '',
      )}`;
    case 'model_call':
      return `[${label}] call ${String(event.payload.step ?? '?')}: ${String(event.payload.input ?? '?')} in, ${String(event.payload.output ?? '?')} out`;
    case 'model_timeout':
      return `[${label}] call ${String(event.payload.step ?? '?')} took over ${String(event.payload.seconds ?? '?')}s; retrying once`;
    case 'job_started':
      return `[${label}] ⧗ ${String(event.payload.id ?? 'job')} ${event.payload.adopted ? 'taken on' : 'started'}: ${String(event.payload.command ?? '')}`;
    case 'job_ended':
      return `[${label}] ⧗ ${String(event.payload.id ?? 'job')} ${String(event.payload.status ?? 'ended')}${
        typeof event.payload.exitCode === 'number' ? ` (exit ${event.payload.exitCode})` : ''
      }${event.payload.reason ? `: ${String(event.payload.reason)}` : ''}`;
    case 'jobs_waited':
      return `[${label}] waited ${String(event.payload.seconds ?? '?')}s for ${((event.payload.jobs as string[] | undefined) ?? []).join(', ')}`;
    case 'node_completed':
      return event.payload.stoppedEarly
        ? `◐ ${label} ran out of model calls; partial result → ${event.payload.next ?? 'end'}`
        : `✔ ${label} → ${event.payload.next ?? 'end'}`;
    case 'node_skipped':
      return `· ${label} skipped`;
    case 'node_failed':
      return `✖ ${label} failed (${String(event.payload.reason ?? 'failed')}): ${String(event.payload.error ?? '')}`;
    case 'edge_taken':
      return `→ ${nodeLabel({ ...event, nodeId: String(event.payload.sourceId ?? '') }, labels)} → ${nodeLabel(
        { ...event, nodeId: String(event.payload.targetId ?? '') },
        labels,
      )}`;
    case 'run_completed':
      return '✔ Run completed.';
    case 'run_failed':
      return `✖ Run failed: ${String(event.payload.error ?? '')}`;
    case 'run_cancelled':
      return '✖ Run cancelled.';
    default:
      return `${event.type}`;
  }
}

function nodeLabel(event: RunEvent, labels: Map<string, string>): string {
  if (event.nodeId === undefined) {
    return typeof event.payload.label === 'string' ? event.payload.label : '';
  }
  return labels.get(event.nodeId) ?? event.nodeId;
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  │ ${line}`)
    .join('\n');
}

function emitResult(run: Run, machineReadable: boolean, minimum: FlowMinimum | undefined): void {
  const result = {
    type: 'result',
    run: {
      id: run.id,
      graphId: run.graphId,
      graphName: run.graphName,
      source: run.source,
      status: run.status,
      outputs: run.outputs,
      ...(run.personOutput ? { personOutput: run.personOutput } : {}),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      ...(run.usage ? { usage: run.usage } : {}),
      ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
      ...(run.unpricedModels ? { unpricedModels: run.unpricedModels } : {}),
      ...(run.pricesAsOf ? { pricesAsOf: run.pricesAsOf } : {}),
      ...(run.stoppedEarlyNodes ? { stoppedEarlyNodes: run.stoppedEarlyNodes } : {}),
      ...(run.jobs && run.jobs.length > 0 ? { jobs: run.jobs } : {}),
      ...(minimum ? { minimum } : {}),
      ...(run.error ? { error: run.error } : {}),
      ...(run.failedNodeId ? { failedNodeId: run.failedNodeId } : {}),
    },
  };

  if (machineReadable) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  process.stderr.write(`${formatResult(result.run)}\n`);
}

function formatResult(run: {
  status: string;
  outputs: Record<string, string>;
  personOutput?: { nodeId: string; output: string };
  error?: string;
  stoppedEarlyNodes?: string[];
}): string {
  const lines = [`Run ${run.status}.`];
  if (run.stoppedEarlyNodes) {
    lines.push(`Partial: ${run.stoppedEarlyNodes.join(', ')} ran out of model calls and handed over what they had.`);
  }
  if (run.personOutput) {
    lines.push('', run.personOutput.output);
  }
  const others = Object.entries(run.outputs).filter(([nodeId]) => nodeId !== run.personOutput?.nodeId);
  if (others.length > 0) {
    lines.push('', 'All node outputs:');
    for (const [nodeId, output] of others) {
      lines.push(`  ${nodeId}: ${output}`);
    }
  }
  if (run.error) {
    lines.push('', `error: ${run.error}`);
  }
  return lines.join('\n');
}

function readEventMode(parsed: ParsedArgs): EventMode {
  const mode = readOptionalFlag(parsed, 'events') ?? (process.stdout.isTTY ? 'pretty' : 'ndjson');
  if (!(EVENT_MODES as readonly string[]).includes(mode)) {
    throw new UsageError(`--events must be one of: ${EVENT_MODES.join(', ')}.`);
  }
  return mode as EventMode;
}

async function readRunInput(parsed: ParsedArgs): Promise<string> {
  const inline = readOptionalFlag(parsed, 'input');
  const file = readOptionalFlag(parsed, 'input-file');

  if (inline !== undefined && file !== undefined) {
    throw new UsageError('--input and --input-file cannot be combined.');
  }
  if (file !== undefined) {
    try {
      return await fs.readFile(file, 'utf8');
    } catch {
      throw new FlowError(`Could not read the input file "${file}".`);
    }
  }
  return inline ?? '';
}
