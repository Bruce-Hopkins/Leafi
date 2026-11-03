import { listPriceOf, type CallTokens } from '../domain/model-prices';
import type { CostSource, ProviderId } from '../domain/types';

/** The parts of a LangChain AI message that carry usage. */
export interface UsageCarrier {
  usage_metadata?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_token_details?: { cache_read?: number; cache_creation?: number };
    output_token_details?: { reasoning?: number };
  };
  response_metadata?: Record<string, unknown>;
}

/** One call's tokens, plus what decides its price. */
export interface CallUsage extends CallTokens {
  total: number;
  reasoning: number;
  /** What the provider billed, when it says so (OpenRouter). */
  billedUsd?: number;
  /** What the upstream provider charged, when OpenRouter reports a figure different from `billedUsd`. */
  upstreamUsd?: number;
  /** Multiplier on every rate, such as Anthropic's 1.1x for US-only inference. */
  multiplier: number;
  /** Set when the call ran on a tier the price table does not cover. */
  unpricedTier?: string;
}

/** What one node's calls added up to. */
export interface MeterSummary {
  input: number;
  output: number;
  total: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  usd?: number;
  costSource?: CostSource;
  upstreamUsd?: number;
  /** Why the node has no `usd`: the model, or the model and the tier it ran on. */
  unpriced?: string;
}

/** One call's figures, as recorded in the run's events. */
export interface CallRecord {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  usd?: number;
  costSource?: CostSource;
}

/**
 * Prices each model call as it happens and keeps the node's running totals.
 * OpenRouter reports what it billed, so its figure is used as is; the direct
 * providers report tokens only, so their calls are priced at list price, one
 * call at a time.
 */
export class UsageMeter {
  iterations = 0;
  private readonly totals: MeterSummary = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  private usd = 0;
  private upstreamUsd = 0;
  private readonly sources = new Set<CostSource>();
  private unpriced?: string;
  private calls = 0;

  constructor(
    private readonly provider?: ProviderId,
    private readonly model?: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Adds one response to the totals; returns its own figures, or undefined when it reported no usage. */
  record(message: UsageCarrier): CallRecord | undefined {
    this.calls += 1;
    if (!message.usage_metadata && !message.response_metadata?.usage) {
      // A call with no reported usage still cost something: block the total rather than understate it.
      this.unpriced ??= `${this.model ?? 'unknown'} (usage not reported)`;
      return undefined;
    }
    const call = readCall(this.provider, message);
    this.totals.input += call.input;
    this.totals.output += call.output;
    this.totals.total += call.total;
    this.totals.cacheRead += call.cacheRead;
    this.totals.cacheWrite += call.cacheWrite + call.cacheWrite1h;
    this.totals.reasoning += call.reasoning;
    this.upstreamUsd += call.upstreamUsd ?? 0;
    const record: CallRecord = {
      input: call.input,
      output: call.output,
      cacheRead: call.cacheRead,
      cacheWrite: call.cacheWrite + call.cacheWrite1h,
      reasoning: call.reasoning,
    };

    if (call.billedUsd !== undefined) {
      this.usd += call.billedUsd;
      this.sources.add('billed');
      return { ...record, usd: call.billedUsd, costSource: 'billed' };
    }
    const listed =
      this.model && !call.unpricedTier ? listPriceOf(this.model, call, this.now(), call.multiplier) : undefined;
    if (listed === undefined) {
      this.unpriced ??= call.unpricedTier ? `${this.model ?? 'unknown'} (${call.unpricedTier})` : (this.model ?? 'unknown');
      return record;
    }
    this.usd += listed;
    this.sources.add('list-price');
    return { ...record, usd: listed, costSource: 'list-price' };
  }

  summary(): MeterSummary {
    const priced = this.calls > 0 && this.unpriced === undefined;
    return {
      ...this.totals,
      ...(priced ? { usd: this.usd, costSource: this.sources.has('list-price') ? 'list-price' : 'billed' } : {}),
      ...(this.upstreamUsd > 0 ? { upstreamUsd: this.upstreamUsd } : {}),
      ...(this.unpriced !== undefined ? { unpriced: this.unpriced } : {}),
    };
  }
}

/** Reads one response's usage, filling in what the LangChain summary leaves out. */
export function readCall(provider: ProviderId | undefined, message: UsageCarrier): CallUsage {
  const meta = message.usage_metadata ?? {};
  const raw = (message.response_metadata?.usage ?? {}) as Record<string, unknown>;
  const input = meta.input_tokens ?? 0;
  let output = meta.output_tokens ?? 0;
  const total = meta.total_tokens ?? input + output;
  let reasoning = meta.output_token_details?.reasoning ?? 0;

  if (provider === 'google' && total > input + output) {
    // Gemini reports thinking tokens apart from the answer, and bills them as output.
    reasoning = total - input - output;
    output += reasoning;
  }

  const call: CallUsage = {
    input,
    output,
    total: Math.max(total, input + output),
    reasoning,
    cacheRead: meta.input_token_details?.cache_read ?? 0,
    cacheWrite: meta.input_token_details?.cache_creation ?? 0,
    cacheWrite1h: 0,
    multiplier: 1,
  };

  if (provider === 'openrouter') {
    const cost = numberOr(raw.cost);
    if (cost !== undefined) {
      call.billedUsd = cost;
    }
    // OpenRouter reports the upstream charge on ordinary calls too, where it equals
    // `cost`; it is only news when it differs, as with the user's own provider key.
    const upstream = numberOr((raw.cost_details as Record<string, unknown> | undefined)?.upstream_inference_cost);
    if (upstream !== undefined && upstream > 0 && Math.abs(upstream - (cost ?? 0)) > 1e-12) {
      call.upstreamUsd = upstream;
    }
  }

  if (provider === 'anthropic') {
    const split = raw.cache_creation as Record<string, unknown> | undefined;
    const hour = numberOr(split?.ephemeral_1h_input_tokens) ?? 0;
    if (hour > 0) {
      call.cacheWrite1h = hour;
      call.cacheWrite = Math.max(0, call.cacheWrite - hour);
    }
    if (raw.inference_geo === 'us') {
      call.multiplier = 1.1;
    }
    if (typeof raw.service_tier === 'string' && raw.service_tier !== 'standard') {
      call.unpricedTier = `${raw.service_tier} tier`;
    }
    if (raw.speed === 'fast') {
      call.unpricedTier = 'fast mode';
    }
  }

  return call;
}

function numberOr(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}
