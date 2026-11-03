import assert from 'node:assert/strict';
import test from 'node:test';
import { HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { ReasoningRelay } from '../src/providers/reasoning-relay';

const details = [{ type: 'reasoning.text', text: 'Job 57 is remote: tentative 4.', format: 'unknown', index: 0 }];

function completion(message: Record<string, unknown>): Response {
  const body = {
    id: `gen-${Math.random()}`,
    object: 'chat.completion',
    created: 0,
    model: 'deepseek/deepseek-v4.1-flash',
    choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: '', ...message } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0001 },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('OpenRouter reasoning is recorded and sent back with the assistant message it belongs to', async () => {
  const requests: Record<string, unknown>[] = [];
  const replies = [
    completion({
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'run_bash', arguments: '{"command":"ls"}' } }],
      reasoning: 'Job 57 is remote: tentative 4.',
      reasoning_details: details,
    }),
    completion({
      tool_calls: [{ id: 'call-2', type: 'function', function: { name: 'run_bash', arguments: '{"command":"pwd"}' } }],
    }),
  ];
  const relay = new ReasoningRelay(async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return replies.shift() ?? completion({});
  });
  const model = new ChatOpenAI({
    model: 'deepseek/deepseek-v4.1-flash',
    apiKey: 'test-key',
    configuration: { baseURL: 'https://openrouter.invalid/api/v1', fetch: relay.fetch },
  }).bindTools([tool(async () => '', { name: 'run_bash', description: 'shell', schema: z.object({ command: z.string() }) })]);

  const history: BaseMessage[] = [new HumanMessage('score the jobs')];
  const first = await model.invoke(history);
  // The library now exposes the reasoning, so the run can record it.
  assert.equal(first.additional_kwargs.reasoning_content, 'Job 57 is remote: tentative 4.');

  history.push(first, new ToolMessage({ content: 'a.json', tool_call_id: 'call-1', name: 'run_bash' }));
  await model.invoke(history);

  const sent = (requests[1]?.messages as Record<string, unknown>[]).find((message) => message.role === 'assistant');
  assert.deepEqual(sent?.reasoning_details, details);
});

test('responses without reasoning, and failed responses, pass through untouched', async () => {
  const relay = new ReasoningRelay(async () => new Response('{"error":"rate limited"}', { status: 429, headers: { 'content-type': 'application/json' } }));
  const response = await relay.fetch('https://openrouter.invalid', { method: 'POST', body: '{"messages":[]}' });
  assert.equal(response.status, 429);
  assert.equal(await response.text(), '{"error":"rate limited"}');
});
