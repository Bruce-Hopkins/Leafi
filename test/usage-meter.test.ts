import assert from 'node:assert/strict';
import test from 'node:test';
import { listPriceOf } from '../src/domain/model-prices';
import { UsageMeter } from '../src/providers/usage-meter';

const OCTOBER = () => new Date('2026-10-28T12:00:00Z');

function close(actual: number | undefined, expected: number): void {
  assert.ok(actual !== undefined, 'expected a price');
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} is not ${expected}`);
}

test('OpenRouter: the billed cost is used as reported, whatever the model', () => {
  const meter = new UsageMeter('openrouter', 'deepseek/deepseek-v4.1-flash', OCTOBER);
  for (const cost of [0.00012, 0.00030]) {
    meter.record({
      usage_metadata: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100 },
      response_metadata: { usage: { prompt_tokens: 1000, completion_tokens: 100, cost } },
    });
  }

  const summary = meter.summary();
  close(summary.usd, 0.00042);
  assert.equal(summary.costSource, 'billed');
  assert.equal(summary.unpriced, undefined);
});

test('OpenRouter: a call without a cost falls back to list price, or blocks the total', () => {
  const listed = new UsageMeter('openrouter', 'anthropic/claude-sonnet-5.5', OCTOBER);
  listed.record({ usage_metadata: { input_tokens: 1_000_000, output_tokens: 0, total_tokens: 1_000_000 } });
  close(listed.summary().usd, 2);
  assert.equal(listed.summary().costSource, 'list-price');

  const unknown = new UsageMeter('openrouter', 'deepseek/deepseek-v4.1-flash', OCTOBER);
  unknown.record({ usage_metadata: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } });
  assert.equal(unknown.summary().usd, undefined);
  assert.equal(unknown.summary().unpriced, 'deepseek/deepseek-v4.1-flash');
});

test('OpenRouter: an upstream charge is kept apart, not added in', () => {
  const meter = new UsageMeter('openrouter', 'openai/gpt-6.1-sol', OCTOBER);
  meter.record({
    usage_metadata: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
    response_metadata: { usage: { cost: 0.001, cost_details: { upstream_inference_cost: 0.02 } } },
  });
  close(meter.summary().usd, 0.001);
  close(meter.summary().upstreamUsd, 0.02);

  // On an ordinary call OpenRouter reports the same figure twice; that is not a second charge.
  const ordinary = new UsageMeter('openrouter', 'deepseek/deepseek-v4.1-flash', OCTOBER);
  ordinary.record({
    usage_metadata: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
    response_metadata: { usage: { cost: 0.001, cost_details: { upstream_inference_cost: 0.001 } } },
  });
  close(ordinary.summary().usd, 0.001);
  assert.equal(ordinary.summary().upstreamUsd, undefined);
});

test('Anthropic: cache reads and 5-minute and 1-hour writes each get their own rate', () => {
  const meter = new UsageMeter('anthropic', 'claude-sonnet-5-5', OCTOBER);
  // 1M fresh, 1M read, 1M written for 5 minutes, 1M written for an hour; 1M out.
  meter.record({
    usage_metadata: {
      input_tokens: 4_000_000,
      output_tokens: 1_000_000,
      total_tokens: 5_000_000,
      input_token_details: { cache_read: 1_000_000, cache_creation: 2_000_000 },
    },
    response_metadata: {
      usage: { service_tier: 'standard', cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 } },
    },
  });

  const summary = meter.summary();
  close(summary.usd, 2 + 0.1 + 2.5 + 4 + 10);
  assert.equal(summary.costSource, 'list-price');
  assert.equal(summary.cacheRead, 1_000_000);
  assert.equal(summary.cacheWrite, 2_000_000);
});

test('Anthropic: US-only inference costs 1.1x, and a priority-tier call is not guessed at', () => {
  const us = new UsageMeter('anthropic', 'claude-haiku-5-5', OCTOBER);
  us.record({
    usage_metadata: { input_tokens: 1_000_000, output_tokens: 0, total_tokens: 1_000_000 },
    response_metadata: { usage: { inference_geo: 'us' } },
  });
  // Over 100k prompt tokens, so the whole request is at Haiku 5.5's long-context rate.
  close(us.summary().usd, 0.5 * 1.1);

  const priority = new UsageMeter('anthropic', 'claude-haiku-5-5', OCTOBER);
  priority.record({
    usage_metadata: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
    response_metadata: { usage: { service_tier: 'priority' } },
  });
  assert.equal(priority.summary().usd, undefined);
  assert.equal(priority.summary().unpriced, 'claude-haiku-5-5 (priority tier)');
});

test('OpenAI: cached input is cheaper, reasoning is already output, long prompts pay more', () => {
  const meter = new UsageMeter('openai', 'gpt-6-luna', OCTOBER);
  meter.record({
    usage_metadata: {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      total_tokens: 2_000_000,
      input_token_details: { cache_read: 500_000 },
      output_token_details: { reasoning: 400_000 },
    },
  });
  // Over 272K prompt tokens: long-context rates $0.20 in, $0.02 cached, $0.75 out.
  close(meter.summary().usd, 0.5 * 0.2 + 0.5 * 0.02 + 0.75);
  assert.equal(meter.summary().reasoning, 400_000);

  const short = listPriceOf('gpt-6-luna', { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 }, OCTOBER());
  close(short, 1000 * 0.1 / 1_000_000);
});

test('Google: thinking tokens are counted and billed as output', () => {
  const meter = new UsageMeter('google', 'gemini-2.5-flash', OCTOBER);
  // LangChain reports only the answer as output; the total includes 600 thinking tokens.
  meter.record({ usage_metadata: { input_tokens: 1000, output_tokens: 400, total_tokens: 2000 } });

  const summary = meter.summary();
  assert.equal(summary.output, 1000);
  assert.equal(summary.reasoning, 600);
  close(summary.usd, (1000 * 0.3 + 1000 * 2.5) / 1_000_000);
});

test('Google: a dated price change applies to calls made after it', () => {
  const tokens = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };
  close(listPriceOf('gemini-3.8-flash', tokens, new Date('2026-12-31T23:00:00Z')), 0.75);
  close(listPriceOf('gemini-3.8-flash', tokens, new Date('2027-01-01T00:00:00Z')), 1.5);
});

test('a call with no usage at all blocks the total instead of counting as free', () => {
  const meter = new UsageMeter('openai', 'gpt-6-luna', OCTOBER);
  meter.record({ usage_metadata: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } });
  meter.record({});
  assert.equal(meter.summary().usd, undefined);
  assert.equal(meter.summary().unpriced, 'gpt-6-luna (usage not reported)');
});
