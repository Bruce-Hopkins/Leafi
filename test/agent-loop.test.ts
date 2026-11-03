import assert from 'node:assert/strict';
import test from 'node:test';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { runAgentLoop, type AgentLoopOptions, type ModelCallRecord } from '../src/graph/agent-loop';
import type { NodeToolkit } from '../src/tools/node-toolkit';

const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };

/** A response that runs one tool. */
function toolCall(id: string, name = 'run_bash'): Record<string, unknown> {
  return { content: '', tool_calls: [{ name, args: { command: `echo ${id}` }, id }], usage_metadata: usage };
}

const finish = { content: '', tool_calls: [{ name: 'complete_task', args: { output: 'done' }, id: 'end' }], usage_metadata: usage };

/**
 * A scripted model: each call takes the next response, and records which tools
 * were offered and the text of the newest message it was sent.
 */
function scripted(responses: Record<string, unknown>[]) {
  const offered: string[][] = [];
  const newest: string[] = [];
  const model = {
    bindTools: (schemas: { name: string }[]) => ({
      invoke: async (messages: BaseMessage[]) => {
        offered.push(schemas.map((schema) => schema.name));
        const last = messages.at(-1);
        newest.push(typeof last?.content === 'string' ? last.content : '');
        return responses.shift() ?? finish;
      },
    }),
  } as unknown as BaseChatModel;
  return { model, offered, newest };
}

function toolkit(result: (name: string) => string = () => 'ok'): NodeToolkit {
  return {
    schemas: [{ name: 'complete_task' }, { name: 'run_bash' }] as unknown as NodeToolkit['schemas'],
    execute: async (name) => result(name),
  };
}

function options(model: BaseChatModel, overrides: Partial<AgentLoopOptions> = {}): AgentLoopOptions {
  return {
    nodeId: 'n',
    model,
    toolkit: toolkit(),
    systemPrompt: 'system',
    inputMessage: 'task',
    branches: [],
    maxIterations: 5,
    signal: new AbortController().signal,
    countStep: () => undefined,
    onToolCall: async () => undefined,
    ...overrides,
  };
}

test('every step tells the node how many model calls it has left, and warns near the end', async () => {
  // Four tool steps, then complete_task on the fifth of six calls: finished, not partial.
  const { model, newest } = scripted([toolCall('1'), toolCall('2'), toolCall('3'), toolCall('4')]);
  const result = await runAgentLoop(options(model, { maxIterations: 6 }));

  assert.equal(result.output, 'done');
  assert.equal(result.stoppedEarly, undefined);
  assert.match(newest[1] ?? '', /\[5 of 6 model calls left\]$/);
  assert.match(newest[3] ?? '', /\[3 of 6 model calls left\. Wrap up/);
  assert.match(newest[4] ?? '', /\[2 of 6 model calls left\. Wrap up/);
});

test('the last call offers only complete_task, and its output is marked partial', async () => {
  // Three tool steps; the fourth and last call can only finish.
  const { model, offered, newest } = scripted([toolCall('1'), toolCall('2'), toolCall('3')]);
  const result = await runAgentLoop(options(model, { maxIterations: 4 }));
  assert.match(newest[3] ?? '', /\[1 of 4 model calls left: the next is your last/);

  assert.deepEqual(offered[0], ['complete_task', 'run_bash']);
  assert.deepEqual(offered[3], ['complete_task']);
  assert.equal(result.output, 'done');
  assert.equal(result.stoppedEarly, true);
  assert.equal(result.iterations, 4);
});

test('a node that answers in text on its last call hands over that text', async () => {
  const { model } = scripted([toolCall('1'), { content: 'Scored 40 of 145 jobs; the rest are unscored.', usage_metadata: usage }]);
  const result = await runAgentLoop(options(model, { maxIterations: 2 }));

  assert.equal(result.output, 'Scored 40 of 145 jobs; the rest are unscored.');
  assert.equal(result.stoppedEarly, true);
});

test('a branching node that never picks a branch still fails, since there is no call left to fix it', async () => {
  const { model } = scripted([toolCall('1'), { content: 'I ran out.', usage_metadata: usage }]);
  await assert.rejects(
    runAgentLoop(options(model, { maxIterations: 2, branches: ['yes', 'no'] })),
    /never called complete_task/,
  );
});

test('the run-wide limit brings the last call forward when it is closer than the node limit', async () => {
  let charged = 0;
  const { model, offered, newest } = scripted([toolCall('1'), toolCall('2')]);
  const result = await runAgentLoop(
    options(model, {
      maxIterations: 25,
      countStep: () => {
        charged += 1;
      },
      runCallsLeft: () => 3 - charged,
    }),
  );

  assert.equal(result.stoppedEarly, true);
  assert.equal(offered.length, 3);
  assert.deepEqual(offered[2], ['complete_task']);
  assert.match(newest[1] ?? '', /\[2 of 3 model calls left\. Wrap up/);
});

test('one response\'s tool results share a limit, and a result past it is cut with a note', async () => {
  const big = 'x'.repeat(3000);
  const responses: Record<string, unknown>[] = [
    { content: '', tool_calls: [1, 2, 3].map((n) => ({ name: 'run_bash', args: {}, id: `c${n}` })), usage_metadata: usage },
  ];
  let sent: BaseMessage[] = [];
  const model = {
    bindTools: () => ({
      invoke: async (messages: BaseMessage[]) => {
        sent = [...messages];
        return responses.shift() ?? finish;
      },
    }),
  } as unknown as BaseChatModel;
  await runAgentLoop(options(model, { toolkit: toolkit(() => big), stepOutputLimitBytes: 5000 }));

  const results = sent.filter((message) => message.type === 'tool').map((message) => String(message.content));
  assert.equal(results.length, 3);
  assert.equal(results[0], big);
  // The second fills the rest of the 5000 bytes; the third keeps only the minimum, so its note survives.
  assert.match(results[1] ?? '', /^x{2000}\n\[cut: this response's tool results reached 5000 bytes together, so the last 1000 bytes/);
  assert.match(results[2] ?? '', /^x{1024}\n\[cut: /);
});

test('each model call is reported with its tokens, cost fields and reasoning', async () => {
  const { model } = scripted([
    { ...toolCall('1'), additional_kwargs: { reasoning_content: 'Job 57 is remote: tentative 4.' } },
  ]);
  const calls: ModelCallRecord[] = [];
  await runAgentLoop(options(model, { onModelCall: async (call) => void calls.push(call) }));

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.step, 1);
  assert.equal(calls[0]?.input, 10);
  assert.equal(calls[0]?.output, 5);
  assert.equal(calls[0]?.reasoningText, 'Job 57 is remote: tentative 4.');
  assert.equal(calls[1]?.reasoningText, undefined);
});

/** A model whose first `hangs` calls never answer until their signal aborts. */
function hanging(hangs: number) {
  let calls = 0;
  const model = {
    bindTools: () => ({
      invoke: async (_messages: BaseMessage[], options: { signal: AbortSignal }) => {
        calls += 1;
        if (calls <= hangs) {
          await new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          });
        }
        return finish;
      },
    }),
  } as unknown as BaseChatModel;
  return { model, calls: () => calls };
}

test('a model call that runs out of time is retried once', async () => {
  const { model, calls } = hanging(1);
  const timeouts: number[] = [];
  const result = await runAgentLoop(
    options(model, { modelCallTimeoutMs: 50, onModelTimeout: async (step) => void timeouts.push(step) }),
  );
  assert.equal(result.output, 'done');
  assert.equal(calls(), 2);
  assert.deepEqual(timeouts, [1]);
});

test('a second timeout in a row fails the node, naming the limit', async () => {
  const { model } = hanging(2);
  await assert.rejects(runAgentLoop(options(model, { modelCallTimeoutMs: 50 })), /did not answer within 50ms, twice in a row \(MODEL_CALL_TIMEOUT_MS\)/);
});

test('a cancelled run is not retried as a timeout', async () => {
  const { model, calls } = hanging(5);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(runAgentLoop(options(model, { modelCallTimeoutMs: 5_000, signal: controller.signal })));
  assert.equal(calls(), 1);
});

test('the step note carries the node\'s jobs and clock, and the wrap-up mentions running jobs', async () => {
  const { model, newest } = scripted([toolCall('1'), toolCall('2'), toolCall('3')]);
  await runAgentLoop(
    options(model, {
      maxIterations: 6,
      stepStatus: () => ({ parts: ['jobs: job-1 running 4m12s', 'run time left 21m'], jobsRunning: true }),
    }),
  );
  assert.match(newest[1] ?? '', /\[5 of 6 model calls left · jobs: job-1 running 4m12s · run time left 21m\]$/);
  assert.match(newest[3] ?? '', /\[3 of 6 model calls left · jobs: .*\. Wrap up: .* Your running jobs are handed to the next node when you finish/);
});
