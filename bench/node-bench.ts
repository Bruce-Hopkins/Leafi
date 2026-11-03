/**
 * Replays one node of a flow several times and reports how reliably it
 * finishes. Each run is real: it spends tokens, so nothing runs without --yes.
 *
 *   pnpm bench --graph flow.json --node score --from-run <runId> --runs 10 --yes
 *
 * With --from-run, the node gets the handoffs it received on that run, and the
 * run's workspace files are copied into each fresh workspace (with the old
 * workspace path rewritten), so every replay starts from the same state.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { FlowService } from '../src/app/flow-service';
import { disableImplicitTracing, loadEnvironment } from '../src/config/env';
import { RuntimeConfig } from '../src/config/runtime-config';
import { minimumGraph } from '../src/domain/flow-estimate';
import type { AgentNode, Graph, Run } from '../src/domain/types';
import { EmailService } from '../src/email/email-service';
import { declaredInputIds } from '../src/graph/prompt';
import { ModelFactory } from '../src/providers/model-factory';
import { RunExecutor } from '../src/runtime/run-executor';
import { RunStore } from '../src/runtime/run-store';

interface Outcome {
  runId: string;
  status: Run['status'];
  finished: boolean;
  stoppedEarly: boolean;
  iterations: number;
  tokens: number;
  usd?: number;
  toolCalls: number;
  repeatedToolCalls: number;
  seconds: number;
  error?: string;
}

const { values } = parseArgs({
  options: {
    graph: { type: 'string' },
    node: { type: 'string' },
    runs: { type: 'string', default: '5' },
    'from-run': { type: 'string' },
    input: { type: 'string' },
    'input-file': { type: 'string' },
    'env-file': { type: 'string' },
    'data-dir': { type: 'string' },
    out: { type: 'string' },
    yes: { type: 'boolean', default: false },
  },
});

async function main(): Promise<void> {
  if (!values.graph || !values.node) {
    throw new Error('Usage: pnpm bench --graph <flow.json> --node <id> [--from-run <runId> | --input <text> | --input-file <path>] [--runs N] [--yes]');
  }
  loadEnvironment({ envFile: values['env-file'], dataDir: values['data-dir'] });
  disableImplicitTracing();

  const config = new RuntimeConfig({ dataDir: values['data-dir'] });
  const store = new RunStore(config);
  const flow = await new FlowService().loadPath(values.graph);
  const node = flow.nodes.find((candidate) => candidate.id === values.node);
  if (!node) {
    throw new Error(`No node "${values.node}" in ${values.graph}. Nodes: ${flow.nodes.map((n) => n.id).join(', ')}.`);
  }
  const runs = Number.parseInt(values.runs ?? '5', 10);
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error('--runs must be a whole number, 1 or more.');
  }

  const source = values['from-run'] ? await savedRun(store, config, flow, node, values['from-run']) : undefined;
  const input = source?.input ?? values.input ?? (values['input-file'] ? fs.readFileSync(values['input-file'], 'utf8') : '');
  const graph = alone(flow, node);
  const minimum = minimumGraph(graph, config);

  process.stderr.write(
    [
      `Node "${node.label}" (${node.id}) on ${node.provider}/${node.model}`,
      `Runs: ${runs}; model calls per run at most ${node.maxIterations ?? config.maxNodeIterations}`,
      `Minimum per run: ${minimum.totalTokens} tokens (a lower bound, not a forecast)`,
      source ? `Replaying run ${values['from-run']}, seeding ${source.seedFiles.length} files: ${source.seedFiles.map((f) => path.basename(f)).join(', ')}` : '',
      '',
    ]
      .filter((line, index, lines) => line !== '' || index === lines.length - 1)
      .join('\n'),
  );
  if (!values.yes) {
    process.stderr.write('Nothing was run. Add --yes to run it; each run spends real tokens.\n');
    return;
  }

  const executor = new RunExecutor(config, store, new ModelFactory(config), new EmailService(config));
  const outcomes: Outcome[] = [];
  for (let index = 0; index < runs; index += 1) {
    const run = store.createRun(graph, input, 'cli');
    const replayInput = source ? input.split(source.workspace).join(config.workspaceFor(run.id)) : input;
    run.input = replayInput;
    const calls: string[] = [];
    const started = Date.now();
    await executor.execute(graph, run, replayInput, {
      save: true,
      ...(source ? { seedFiles: source.seedFiles } : {}),
      onEvent: (event) => {
        if (event.type === 'tool_call') {
          calls.push(`${String(event.payload.tool)} ${JSON.stringify(event.payload.args)}`);
        }
      },
    });
    const usage = run.usage?.[node.id];
    const stoppedEarly = run.stoppedEarlyNodes?.includes(node.id) ?? false;
    const outcome: Outcome = {
      runId: run.id,
      status: run.status,
      finished: run.status === 'completed' && !stoppedEarly,
      stoppedEarly,
      iterations: usage?.iterations ?? 0,
      tokens: usage?.total ?? 0,
      ...(usage?.usd !== undefined ? { usd: usage.usd } : {}),
      toolCalls: calls.length,
      repeatedToolCalls: calls.length - new Set(calls).size,
      seconds: Math.round((Date.now() - started) / 1000),
      ...(run.error ? { error: run.error } : {}),
    };
    outcomes.push(outcome);
    process.stderr.write(`${index + 1}/${runs} ${describe(outcome)}\n`);
  }

  const report = { node: node.id, model: node.model, runs, outcomes, summary: summarize(outcomes) };
  process.stderr.write(`\n${formatSummary(report.summary, runs)}\n`);
  if (values.out) {
    fs.writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write(`Report written to ${path.resolve(values.out)}\n`);
  }
}

/** The node on its own, as the only (entry) node, so it receives the replayed handoffs as its input. */
function alone(flow: Graph, node: AgentNode): Graph {
  const { inputs: _inputs, ...rest } = node;
  return { ...flow, name: `${flow.name} — ${node.label} (bench)`, nodes: [rest], edges: [] };
}

/** What the node received on a saved run: its producers' handoffs, and the run's workspace files. */
async function savedRun(store: RunStore, config: RuntimeConfig, flow: Graph, node: AgentNode, runId: string) {
  const run = await store.readRun(runId);
  if (!run) {
    throw new Error(`No saved run ${runId}.`);
  }
  const sections = declaredInputIds(flow, node).map((id) => {
    if (id === '$input') {
      return run.input;
    }
    const label = flow.nodes.find((candidate) => candidate.id === id)?.label ?? id;
    const output = run.outputs[id];
    if (output === undefined) {
      throw new Error(`Run ${runId} has no output from "${label}", which "${node.label}" reads.`);
    }
    return `## ${label}\n\n${output}`;
  });
  const workspace = config.workspaceFor(runId);
  const started = nodeStartedAt(store, runId, node.id);
  // Only top-level files as they were when the node started: what it wrote itself, scratch
  // folders and saved tool output stay behind, so every replay starts from the same state.
  const seedFiles = fs
    .readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(workspace, entry.name))
    .filter((file) => fs.statSync(file).mtimeMs < started);
  return { input: sections.join('\n\n'), workspace, seedFiles };
}

/** When the node started on the saved run, from its events; without them, nothing is assumed earlier. */
function nodeStartedAt(store: RunStore, runId: string, nodeId: string): number {
  const file = store.eventsFile(runId);
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const event = JSON.parse(line) as { type?: string; nodeId?: string; createdAt?: string };
    if (event.type === 'node_started' && event.nodeId === nodeId && event.createdAt) {
      return Date.parse(event.createdAt);
    }
  }
  throw new Error(`Run ${runId} has no record of "${nodeId}" starting, so its starting files are unknown.`);
}

function describe(outcome: Outcome): string {
  const state = outcome.finished ? 'finished' : outcome.stoppedEarly ? 'stopped early (partial)' : `failed: ${outcome.error ?? outcome.status}`;
  const cost = outcome.usd !== undefined ? `$${outcome.usd.toFixed(4)}` : 'unpriced';
  return `${state} · ${outcome.iterations} calls · ${outcome.tokens} tokens · ${cost} · ${outcome.toolCalls} tool calls (${outcome.repeatedToolCalls} repeated) · ${outcome.seconds}s · ${outcome.runId}`;
}

function summarize(outcomes: Outcome[]) {
  const priced = outcomes.filter((outcome) => outcome.usd !== undefined);
  return {
    finished: outcomes.filter((outcome) => outcome.finished).length,
    stoppedEarly: outcomes.filter((outcome) => outcome.stoppedEarly).length,
    failed: outcomes.filter((outcome) => outcome.status !== 'completed').length,
    medianIterations: median(outcomes.map((outcome) => outcome.iterations)),
    medianTokens: median(outcomes.map((outcome) => outcome.tokens)),
    totalUsd: priced.length === outcomes.length ? priced.reduce((sum, outcome) => sum + (outcome.usd ?? 0), 0) : undefined,
    repeatedToolCalls: outcomes.reduce((sum, outcome) => sum + outcome.repeatedToolCalls, 0),
  };
}

function formatSummary(summary: ReturnType<typeof summarize>, runs: number): string {
  return [
    `Finished: ${summary.finished}/${runs} · stopped early: ${summary.stoppedEarly} · failed: ${summary.failed}`,
    `Median calls: ${summary.medianIterations} · median tokens: ${summary.medianTokens} · repeated tool calls: ${summary.repeatedToolCalls}`,
    `Total cost: ${summary.totalUsd !== undefined ? `$${summary.totalUsd.toFixed(4)}` : 'not fully priced'}`,
  ].join('\n');
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
