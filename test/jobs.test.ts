import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FlowService } from '../src/app/flow-service';
import { RuntimeConfig } from '../src/config/runtime-config';
import type { AgentNode } from '../src/domain/types';
import { EmailService } from '../src/email/email-service';
import type { ModelFactory } from '../src/providers/model-factory';
import { RunExecutor } from '../src/runtime/run-executor';
import { RunStore } from '../src/runtime/run-store';
import { JobRegistry, NodeJobs } from '../src/tools/jobs';
import { createNodeToolkit } from '../src/tools/node-toolkit';
import { Workspace } from '../src/tools/workspace';

const POSIX = process.platform !== 'win32';
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const bashNode: AgentNode = {
  id: 'n',
  label: 'Scrape',
  provider: 'openai',
  model: 'gpt-4o-mini',
  prompt: 'p',
  position: { x: 0, y: 0 },
  permissions: { read: false, write: false, bash: true, web: false, email_read: false, browser: false },
};

async function jobToolkit(options: { jobTimeoutMs?: number; runTimeLeftMs?: number } = {}) {
  const workspace = await Workspace.open(makeTempDir('graph-agents-jobs-'));
  const registry = new JobRegistry({
    workspace,
    timeoutMs: options.jobTimeoutMs ?? 60_000,
    runDeadline: Date.now() + (options.runTimeLeftMs ?? 60_000),
  });
  const jobs = new NodeJobs(registry, bashNode.id, [], () => bashNode.label);
  const toolkit = createNodeToolkit({
    node: bashNode,
    workspace,
    limits: {
      bashTimeoutMs: 5_000,
      bashTimeoutMaxMs: 10_000,
      outputLimitBytes: 8192,
      outputSaveLimitBytes: 65536,
      webFetchTimeoutMs: 5000,
      webFetchLimitBytes: 65536,
    },
    signal: new AbortController().signal,
    jobs,
  });
  return { toolkit, registry, jobs, workspace };
}

test('a background job returns at once, and one wait_job call waits for it to end', { skip: !POSIX }, async (t) => {
  const { toolkit, registry } = await jobToolkit();
  t.after(() => registry.stopAll('test over'));

  const started = Date.now();
  const result = await toolkit.execute('run_bash', { command: 'sleep 0.6; echo crawled 115 jobs', background: true });
  assert.ok(Date.now() - started < 500, 'starting a job must not wait for it');
  assert.match(result, /^Started job-1 in the background/);
  assert.match(result, /\.jobs\/job-1\.log/);

  const running = await toolkit.execute('job_status', {});
  assert.match(running, /job-1 \(sleep 0\.6; echo crawled 115 jobs\) · running/);

  const waited = await toolkit.execute('wait_job', { ids: ['job-1'] });
  assert.match(waited, /^Waited .*: every job has ended\./);
  assert.match(waited, /exited with code 0/);
  assert.match(waited, /End of log:\ncrawled 115 jobs/);
});

test('a job still running at its deadline is killed with everything it started', { skip: !POSIX }, async (t) => {
  const { toolkit, registry, workspace } = await jobToolkit();
  t.after(() => registry.stopAll('test over'));

  await toolkit.execute('run_bash', { command: 'sleep 60 & echo $! > child.pid; sleep 60', background: true, timeoutSeconds: 0.5 });
  const waited = await toolkit.execute('wait_job', {});
  assert.match(waited, /timed out after/);
  const pid = Number(fs.readFileSync(path.join(workspace.root, 'child.pid'), 'utf8').trim());
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(alive(pid), false, 'the job\'s own background child must be killed too');
});

test('wait_job stops at the seconds asked for and says the jobs still run', { skip: !POSIX }, async (t) => {
  const { toolkit, registry } = await jobToolkit();
  t.after(() => registry.stopAll('test over'));

  await toolkit.execute('run_bash', { command: 'sleep 30', background: true });
  const started = Date.now();
  const waited = await toolkit.execute('wait_job', { seconds: 0.3 });
  assert.ok(Date.now() - started < 2000);
  assert.match(waited, /some jobs are still running/);
  assert.match(waited, /job-1 .* · running/);

  const stopped = await toolkit.execute('stop_job', { id: 'job-1' });
  assert.match(stopped, /stopped after .*stopped by "Scrape"/);
});

test('a foreground command that leaves a process running hands it over as a job', { skip: !POSIX }, async (t) => {
  const { toolkit, registry, workspace } = await jobToolkit();
  t.after(() => registry.stopAll('test over'));

  const result = await toolkit.execute('run_bash', { command: 'nohup sleep 30 > /dev/null 2>&1 & echo $! > bg.pid; echo launched' });
  assert.match(result, /^Exit code: 0\n\[This command left processes running in the background; they are now job-1/);
  assert.match(result, /launched$/);

  const pid = Number(fs.readFileSync(path.join(workspace.root, 'bg.pid'), 'utf8').trim());
  assert.equal(alive(pid), true);
  assert.equal(registry.get('job-1')?.adopted, true);
  await toolkit.execute('stop_job', { id: 'job-1' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(alive(pid), false);
});

test('a node can only touch the jobs it holds', { skip: !POSIX }, async () => {
  const { toolkit } = await jobToolkit();
  const result = await toolkit.execute('stop_job', { id: 'job-7' });
  assert.match(result, /^Error: job-7 is not among your jobs\. You hold: none\./);
});

test('a foreground command can ask for longer, up to the cap', { skip: !POSIX }, async () => {
  const { toolkit } = await jobToolkit();
  const capped = await toolkit.execute('run_bash', { command: 'sleep 0.4; echo done', timeoutSeconds: 0.2 });
  assert.match(capped, /^Killed after 200ms/);
  assert.match(capped, /pass a larger timeoutSeconds \(at most 10\) or background: true/);
});

const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };

/** One scripted model per node, by node id. */
function modelsByNode(scripts: Record<string, Record<string, unknown>[]>, seen: Record<string, string[]>): ModelFactory {
  return {
    create: (node: AgentNode) => ({
      bindTools: () => ({
        invoke: async (messages: { content: unknown }[]) => {
          (seen[node.id] ??= []).push(String(messages[1]?.content ?? ''));
          const next = scripts[node.id]?.shift();
          return next ?? { content: '', tool_calls: [{ name: 'complete_task', args: { output: `${node.id} done` }, id: 'end' }], usage_metadata: usage };
        },
      }),
    }),
  } as unknown as ModelFactory;
}

function twoNodeFlow(waitForJobs: boolean) {
  const permissions = { bash: true };
  return new FlowService().loadPayload({
    name: 'jobs',
    nodes: [
      { id: 'scrape', label: 'Scrape', provider: 'openai', model: 'gpt-4o-mini', prompt: 'crawl', permissions },
      { id: 'score', label: 'Score', provider: 'openai', model: 'gpt-4o-mini', prompt: 'score', permissions, waitForJobs },
    ],
    edges: [{ source: 'scrape', target: 'score' }],
  });
}

test('a job still running when its node finishes is handed to the next node', { skip: !POSIX }, async () => {
  const dir = makeTempDir('graph-agents-jobs-run-');
  const config = new RuntimeConfig({ dataDir: dir });
  const store = new RunStore(config);
  const seen: Record<string, string[]> = {};
  const models = modelsByNode(
    {
      scrape: [{ content: '', tool_calls: [{ name: 'run_bash', args: { command: 'sleep 30', background: true }, id: 'c1' }], usage_metadata: usage }],
      score: [{ content: '', tool_calls: [{ name: 'stop_job', args: { id: 'job-1' }, id: 'c2' }], usage_metadata: usage }],
    },
    seen,
  );
  const executor = new RunExecutor(config, store, models, new EmailService(config));
  const graph = twoNodeFlow(false);
  const run = store.createRun(graph, 'go', 'cli');
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  await executor.execute(graph, run, 'go', { save: false, onEvent: (event) => events.push(event) });

  assert.equal(run.status, 'completed');
  const scoreInput = seen.score?.[0] ?? '';
  assert.match(scoreInput, /# Background jobs handed to you\nThey are yours now/);
  assert.match(scoreInput, /- job-1 \(sleep 30\) · running .* · started by "Scrape"/);
  const handedOff = events.find((event) => event.type === 'node_completed' && event.payload.output === 'scrape done');
  assert.deepEqual(handedOff?.payload.jobs, ['job-1']);
  assert.equal(run.jobs?.[0]?.status, 'stopped');
  assert.equal(run.jobs?.[0]?.reason, 'stopped by "Score"');
});

test('waitForJobs holds a node until its jobs end, at no model cost', { skip: !POSIX }, async () => {
  const dir = makeTempDir('graph-agents-jobs-run-');
  const config = new RuntimeConfig({ dataDir: dir });
  const store = new RunStore(config);
  const seen: Record<string, string[]> = {};
  const models = modelsByNode(
    {
      scrape: [
        {
          content: '',
          tool_calls: [{ name: 'run_bash', args: { command: 'sleep 0.5; echo 115 jobs written', background: true }, id: 'c1' }],
          usage_metadata: usage,
        },
      ],
    },
    seen,
  );
  const executor = new RunExecutor(config, store, models, new EmailService(config));
  const graph = twoNodeFlow(true);
  const run = store.createRun(graph, 'go', 'cli');
  const events: string[] = [];
  await executor.execute(graph, run, 'go', { save: false, onEvent: (event) => events.push(event.type) });

  assert.equal(run.status, 'completed');
  assert.ok(events.indexOf('jobs_waited') > events.indexOf('job_ended'));
  assert.equal(run.usage?.score?.iterations, 1);
  const scoreInput = seen.score?.[0] ?? '';
  assert.match(scoreInput, /- job-1 .* · exited with code 0 after/);
  assert.match(scoreInput, /End of log:\n {2}115 jobs written/);
});

test('jobs still running when the run ends are stopped and recorded', { skip: !POSIX }, async () => {
  const dir = makeTempDir('graph-agents-jobs-run-');
  const config = new RuntimeConfig({ dataDir: dir });
  const store = new RunStore(config);
  const models = modelsByNode(
    { scrape: [{ content: '', tool_calls: [{ name: 'run_bash', args: { command: 'sleep 30', background: true }, id: 'c1' }], usage_metadata: usage }] },
    {},
  );
  const executor = new RunExecutor(config, store, models, new EmailService(config));
  const graph = new FlowService().loadPayload({
    name: 'one',
    nodes: [{ id: 'scrape', label: 'Scrape', provider: 'openai', model: 'gpt-4o-mini', prompt: 'crawl', permissions: { bash: true } }],
    edges: [],
  });
  const run = store.createRun(graph, 'go', 'cli');
  await executor.execute(graph, run, 'go', { save: true });

  assert.equal(run.status, 'completed');
  assert.equal(run.jobs?.[0]?.status, 'stopped');
  assert.equal(run.jobs?.[0]?.reason, 'the run ended');
  const stored = await store.readRun(run.id);
  assert.equal(stored?.jobs?.[0]?.status, 'stopped');
});

test('waitForJobs must be true or false', () => {
  assert.throws(
    () =>
      new FlowService().loadPayload({
        name: 'x',
        nodes: [{ id: 'a', label: 'A', provider: 'openai', model: 'm', prompt: 'p', waitForJobs: 'yes' }],
        edges: [],
      }),
    /waitForJobs must be true or false/,
  );
});
