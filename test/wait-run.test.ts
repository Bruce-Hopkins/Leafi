import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { FlowLibrary } from '../src/app/flow-library';
import { FlowService } from '../src/app/flow-service';
import type { RunService, StartedRun, StartRunOptions } from '../src/app/run-service';
import { RuntimeConfig } from '../src/config/runtime-config';
import type { Graph, Run, RunEvent, RunEventType } from '../src/domain/types';
import type { McpContext } from '../src/mcp/context';
import type { McpPolicy } from '../src/mcp/policy';
import { createMcpResults } from '../src/mcp/results';
import { RunManager, WaitAborted } from '../src/mcp/run-manager';
import { RUN_EVENTS_CAPABILITY, RUN_NOTIFICATION } from '../src/mcp/run-notifications';
import { createMcpServer } from '../src/mcp/server';
import type { RunStore } from '../src/runtime/run-store';

/**
 * A run the test drives by hand. `emit` mirrors RunEventSink: the event is in
 * the log before the listener hears of it. `settle` mirrors the executor:
 * status and record are final before `done` resolves.
 */
class FakeRuns {
  readonly events = new Map<string, RunEvent[]>();
  readonly runs = new Map<string, Run>();
  private listeners = new Map<string, (event: RunEvent) => void>();
  private finish = new Map<string, () => void>();
  private count = 0;

  service(): RunService {
    return {
      start: async (_graph: Graph, input: string, options: StartRunOptions): Promise<StartedRun> => {
        this.count += 1;
        const id = `run-${this.count}`;
        const run = { id, graphId: 'g', graphName: 'g', input, status: 'running', outputs: {}, startedAt: new Date().toISOString() } as Run;
        this.runs.set(id, run);
        this.events.set(id, []);
        if (options.onEvent) this.listeners.set(id, options.onEvent);
        const done = new Promise<Run>((resolve) => {
          this.finish.set(id, () => resolve(run));
          options.signal?.addEventListener('abort', () => {
            run.status = 'cancelled';
            resolve(run);
          });
        });
        return { run, done };
      },
      listRuns: async () => [...this.runs.values()],
    } as unknown as RunService;
  }

  store(): RunStore {
    return {
      readRun: async (id: string) => this.runs.get(id) ?? null,
      readEvents: async (id: string) => [...(this.events.get(id) ?? [])],
    } as unknown as RunStore;
  }

  emit(runId: string, type: RunEventType, nodeId?: string, payload: Record<string, unknown> = {}): void {
    const log = this.events.get(runId) ?? [];
    const event: RunEvent = { id: `${runId}-${log.length}`, runId, seq: log.length, type, nodeId, payload, createdAt: new Date().toISOString() };
    log.push(event);
    this.events.set(runId, log);
    this.listeners.get(runId)?.(event);
  }

  settle(runId: string, status: Run['status'] = 'completed'): void {
    const run = this.runs.get(runId);
    if (run) {
      run.status = status;
      run.personOutput = { nodeId: 'a', output: 'the answer' };
    }
    this.finish.get(runId)?.();
  }
}

const POLICY = {
  maxConcurrentRuns: 4,
  allowBash: true,
  allowWrite: true,
  allowWeb: true,
  allowEmail: true,
  allowMcp: true,
  allowFlowPaths: false,
  maxFlowBytes: 1 << 20,
  maxResultBytes: 1 << 20,
} as McpPolicy;
const GRAPH = { id: 'g', name: 'g', nodes: [], edges: [] } as unknown as Graph;

function setup() {
  const fake = new FakeRuns();
  const manager = new RunManager(fake.service(), fake.store(), POLICY);
  return { fake, manager };
}

/** Lets pending promise callbacks run, without a timer standing in for an event. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('wait wakes on the event it waits for, not on a timer', async () => {
  const { fake, manager } = setup();
  const run = await manager.start(GRAPH, '');
  let settled = false;
  const waiting = manager.wait(run.id, { afterSeq: 0, until: 'node', timeoutMs: 60_000 }).then((result) => {
    settled = true;
    return result;
  });

  await flush();
  fake.emit(run.id, 'node_started', 'a', { label: 'Fetch' });
  fake.emit(run.id, 'model_call', 'a');
  await flush();
  assert.equal(settled, false, 'a start and a model call are not what "node" waits for');

  const startedAt = Date.now();
  fake.emit(run.id, 'node_completed', 'a');
  const result = await waiting;
  assert.ok(Date.now() - startedAt < 1000);
  assert.equal(result?.timedOut, false);
  assert.equal(result?.finished, false);
  assert.equal(result?.nextSeq, 3);
  assert.deepEqual(result?.events.map((event) => event.type), ['node_started', 'model_call', 'node_completed']);
  assert.equal(result?.labels.a, 'Fetch');
  assert.equal(manager.feed.waiting(run.id), 0, 'no wake-up left behind');
});

test('"done" waits for the record to be final, not for the run_completed event', async () => {
  const { fake, manager } = setup();
  const run = await manager.start(GRAPH, '');
  let settled = false;
  const waiting = manager.wait(run.id, { afterSeq: 0, until: 'done', timeoutMs: 60_000 }).then((result) => {
    settled = true;
    return result;
  });
  fake.emit(run.id, 'node_completed', 'a');
  fake.emit(run.id, 'run_completed');
  await flush();
  assert.equal(settled, false);

  fake.settle(run.id);
  const result = await waiting;
  assert.equal(result?.finished, true);
  assert.equal(result?.run.status, 'completed');
  assert.equal(result?.run.personOutput?.output, 'the answer');
});

test('an event recorded in the same tick as the call is not missed', async () => {
  const { fake, manager } = setup();
  const run = await manager.start(GRAPH, '');
  const waiting = manager.wait(run.id, { afterSeq: 0, until: 'node', timeoutMs: 60_000 });
  fake.emit(run.id, 'node_completed', 'a'); // before the wait has even read the log
  const result = await waiting;
  assert.equal(result?.timedOut, false);
  assert.equal(result?.nextSeq, 1);
});

test('afterSeq skips what was already shown, and a finished run returns at once', async () => {
  const { fake, manager } = setup();
  const run = await manager.start(GRAPH, '');
  fake.emit(run.id, 'node_started', 'a', { label: 'Fetch' });
  fake.emit(run.id, 'node_completed', 'a');
  fake.settle(run.id);
  await flush();

  const result = await manager.wait(run.id, { afterSeq: 1, until: 'done', timeoutMs: 60_000 });
  assert.equal(result?.finished, true);
  assert.deepEqual(result?.events.map((event) => event.seq), [1]);
  assert.equal(result?.labels.a, 'Fetch', 'labels come from the whole log, not just the page');
});

test('a wait that runs out says so and hands back where to resume', async () => {
  const { fake, manager } = setup();
  const run = await manager.start(GRAPH, '');
  fake.emit(run.id, 'node_started', 'a');
  const result = await manager.wait(run.id, { afterSeq: 0, until: 'done', timeoutMs: 30 });
  assert.equal(result?.timedOut, true);
  assert.equal(result?.finished, false);
  assert.equal(result?.nextSeq, 1);
  assert.equal(manager.feed.waiting(run.id), 0);
});

test('aborting stops the wait and leaves the run going', async () => {
  const { fake, manager } = setup();
  const run = await manager.start(GRAPH, '');
  const controller = new AbortController();
  const waiting = manager.wait(run.id, { afterSeq: 0, until: 'done', timeoutMs: 60_000, signal: controller.signal });
  await flush();
  controller.abort();
  await assert.rejects(waiting, WaitAborted);
  assert.equal(manager.feed.waiting(run.id), 0);
  assert.equal(fake.runs.get(run.id)?.status, 'running');
});

test('shutdown releases every waiter with the final state', async () => {
  const { manager } = setup();
  const run = await manager.start(GRAPH, '');
  const waiters = [1, 2, 3].map(() => manager.wait(run.id, { afterSeq: 0, until: 'done', timeoutMs: 60_000 }));
  await flush();
  await manager.shutdown();
  for (const result of await Promise.all(waiters)) {
    assert.equal(result?.finished, true);
    assert.equal(result?.run.status, 'cancelled');
  }
});

test('an unknown run is null, and a run left running by a dead process returns at once', async () => {
  const { fake, manager } = setup();
  assert.equal(await manager.wait('nope', { afterSeq: 0, until: 'done', timeoutMs: 60_000 }), null);

  fake.runs.set('orphan', { id: 'orphan', status: 'running', outputs: {}, startedAt: '' } as unknown as Run);
  const result = await manager.wait('orphan', { afterSeq: 0, until: 'done', timeoutMs: 60_000 });
  assert.equal(result?.finished, false);
  assert.equal(result?.timedOut, false);
  assert.match(result?.note ?? '', /no server is running it/);
});

// --- Over MCP: the plain client waits, the plugin is pushed ---------------------

async function serve(fake: FakeRuns, client: Client) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leafi-wait-'));
  const config = new RuntimeConfig({ dataDir });
  const manager = new RunManager(fake.service(), fake.store(), POLICY);
  const context = {
    config,
    flows: new FlowService(),
    library: new FlowLibrary(config),
    runs: fake.service(),
    runManager: manager,
    store: fake.store(),
    policy: POLICY,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    results: createMcpResults(POLICY.maxResultBytes),
  } as unknown as McpContext;
  const server = createMcpServer(context);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  return {
    async close() {
      await client.close();
      await server.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const FLOW = {
  name: 'wait-test',
  nodes: [{ id: 'a', label: 'Fetch', provider: 'openai', model: 'gpt-4o-mini', prompt: 'Say hi.', audience: 'person' }],
  edges: [],
};

function json(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const content = result.content as { text?: string }[];
  return JSON.parse(content.map((part) => part.text ?? '').join(''));
}

test('a plain MCP client is told to wait, and wait_run streams progress for its call', async () => {
  const fake = new FakeRuns();
  const client = new Client({ name: 'plain', version: '1' });
  const pushed: unknown[] = [];
  client.fallbackNotificationHandler = async (notification) => {
    pushed.push(notification);
  };
  const session = await serve(fake, client);
  try {
    const started = json(await client.callTool({ name: 'start_run', arguments: { flow: FLOW } }));
    assert.equal(started.delivery, 'wait');
    const runId = String(started.id);

    const progress: string[] = [];
    const waiting = client.callTool({ name: 'wait_run', arguments: { runId } }, undefined, {
      onprogress: (update) => progress.push(update.message ?? ''),
    });
    await flush();
    fake.emit(runId, 'node_started', 'a', { label: 'Fetch' });
    fake.emit(runId, 'model_call', 'a');
    fake.emit(runId, 'node_completed', 'a', { output: 'node output is never pushed' });
    fake.emit(runId, 'run_completed');
    fake.settle(runId);

    const result = json(await waiting);
    assert.equal(result.finished, true);
    assert.equal((result.run as Run).personOutput?.output, 'the answer');
    assert.deepEqual(
      (result.events as { type: string }[]).map((event) => event.type),
      ['node_started', 'node_completed', 'run_completed'],
      'milestones only',
    );
    assert.deepEqual(progress, ['▶ Fetch', '✔ Fetch', 'run completed']);
    assert.deepEqual(pushed, [], 'a client that did not ask is pushed nothing');
  } finally {
    await session.close();
  }
});

test('a plugin client is pushed each milestone and the end, and told delivery "plugin"', async () => {
  const fake = new FakeRuns();
  const client = new Client({ name: 'plugin', version: '1' }, { capabilities: { experimental: { [RUN_EVENTS_CAPABILITY]: {} } } });
  const pushed: Record<string, unknown>[] = [];
  let ended: () => void = () => undefined;
  const end = new Promise<void>((resolve) => {
    ended = resolve;
  });
  client.setNotificationHandler(z.object({ method: z.literal(RUN_NOTIFICATION), params: z.record(z.string(), z.unknown()) }), (notification) => {
    pushed.push(notification.params);
    if (notification.params.kind === 'settled') ended();
  });
  const session = await serve(fake, client);
  try {
    const started = json(await client.callTool({ name: 'start_run', arguments: { flow: FLOW } }));
    assert.equal(started.delivery, 'plugin');
    const runId = String(started.id);

    fake.emit(runId, 'node_started', 'a', { label: 'Fetch' });
    fake.emit(runId, 'model_call', 'a');
    fake.emit(runId, 'node_completed', 'a', { output: 'node output is never pushed' });
    fake.settle(runId);
    await end;

    assert.deepEqual(
      pushed.map((params) => (params.kind === 'event' ? (params.event as { type: string; label?: string }).type : params.kind)),
      ['node_started', 'node_completed', 'settled'],
    );
    assert.equal((pushed[1]?.event as { label?: string }).label, 'Fetch');
    assert.doesNotMatch(JSON.stringify(pushed), /node output is never pushed/);
    assert.equal(pushed[2]?.status, 'completed');
    assert.equal(pushed[2]?.hasPersonOutput, true);
  } finally {
    await session.close();
  }
});
