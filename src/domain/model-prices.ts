/** Rates in USD per million tokens. A missing cache rate falls back to `input`. */
export interface Rates {
  input: number;
  output: number;
  /** Cache hits and refreshes. */
  cacheRead?: number;
  /** Cache writes with the default (5-minute) lifetime. */
  cacheWrite?: number;
  /** Cache writes with a 1-hour lifetime. */
  cacheWrite1h?: number;
}

interface PriceEntry {
  pattern: RegExp;
  rates: Rates;
  /** A request whose prompt is over `above` tokens pays these rates for the whole request. */
  longContext?: { above: number; rates: Rates };
  /** Rates that replace `rates` for calls made on or after `from` (UTC date). */
  changes?: { from: string; rates: Rates }[];
}

/** The date the table was last checked against each provider's pricing page. */
export const PRICES_AS_OF = '2026-10-28';

/**
 * Standard-tier list prices, from each provider's pricing page as of
 * `PRICES_AS_OF`. Each pattern matches one model id exactly, with or without a
 * `vendor/` prefix, a dotted version (`4.5` for `4-5`) or a date suffix. A
 * model not listed here is reported in `unpricedModels` rather than priced by
 * guesswork. OpenRouter calls do not use this table when OpenRouter reports
 * the billed cost.
 */
const MODEL_PRICES: PriceEntry[] = [
  // Anthropic: platform.claude.com/docs/en/about-claude/pricing
  {
    pattern: modelId('claude-fable-5[-.]1'),
    rates: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5, cacheWrite1h: 20 },
  },
  {
    pattern: modelId('claude-fable-5'),
    rates: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, cacheWrite1h: 20 },
  },
  {
    pattern: modelId('claude-opus-5[-.]5'),
    rates: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, cacheWrite1h: 8 },
  },
  {
    pattern: modelId('claude-opus-(?:5|4[-.][5-8])'),
    rates: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 },
  },
  {
    pattern: modelId('claude-sonnet-5[-.]5'),
    rates: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 },
  },
  {
    pattern: modelId('claude-sonnet-5'),
    rates: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite1h: 4 },
  },
  {
    pattern: modelId('claude-sonnet-4[-.][56]'),
    rates: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, cacheWrite1h: 6 },
  },
  {
    pattern: modelId('claude-haiku-5[-.]5'),
    rates: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite1h: 0.2 },
    longContext: {
      above: 100_000,
      rates: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625, cacheWrite1h: 1 },
    },
  },
  {
    pattern: modelId('claude-haiku-4[-.]5'),
    rates: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite1h: 2 },
  },
  // OpenAI: developers.openai.com/api/docs/pricing. Long context is over 272K input tokens.
  {
    pattern: modelId('gpt-6-astra'),
    rates: { input: 10, output: 50, cacheRead: 1 },
    longContext: { above: 272_000, rates: { input: 20, output: 75, cacheRead: 2 } },
  },
  {
    pattern: modelId('gpt-6-sol'),
    rates: { input: 2, output: 10, cacheRead: 0.2 },
    longContext: { above: 272_000, rates: { input: 4, output: 15, cacheRead: 0.4 } },
  },
  {
    pattern: modelId('gpt-6\\.1-sol'),
    rates: { input: 2, output: 10, cacheRead: 0.1 },
    longContext: { above: 272_000, rates: { input: 4, output: 15, cacheRead: 0.2 } },
  },
  {
    pattern: modelId('gpt-6\\.1-terra'),
    rates: { input: 1, output: 5, cacheRead: 0.05 },
    longContext: { above: 272_000, rates: { input: 2, output: 7.5, cacheRead: 0.1 } },
  },
  {
    pattern: modelId('gpt-6-luna'),
    rates: { input: 0.1, output: 0.5, cacheRead: 0.01 },
    longContext: { above: 272_000, rates: { input: 0.2, output: 0.75, cacheRead: 0.02 } },
  },
  {
    pattern: modelId('gpt-5\\.5'),
    rates: { input: 5, output: 30, cacheRead: 0.5 },
    longContext: { above: 272_000, rates: { input: 10, output: 45, cacheRead: 1 } },
  },
  {
    pattern: modelId('gpt-5\\.4'),
    rates: { input: 2.5, output: 15, cacheRead: 0.25 },
    longContext: { above: 272_000, rates: { input: 5, output: 22.5, cacheRead: 0.5 } },
  },
  { pattern: modelId('gpt-5\\.4-mini'), rates: { input: 0.75, output: 4.5, cacheRead: 0.075 } },
  { pattern: modelId('gpt-5\\.4-nano'), rates: { input: 0.2, output: 1.25, cacheRead: 0.02 } },
  { pattern: modelId('gpt-4\\.1'), rates: { input: 2, output: 8, cacheRead: 0.5 } },
  { pattern: modelId('gpt-4\\.1-mini'), rates: { input: 0.4, output: 1.6, cacheRead: 0.1 } },
  { pattern: modelId('gpt-4\\.1-nano'), rates: { input: 0.1, output: 0.4, cacheRead: 0.025 } },
  { pattern: modelId('gpt-4o'), rates: { input: 2.5, output: 10, cacheRead: 1.25 } },
  { pattern: modelId('gpt-4o-mini'), rates: { input: 0.15, output: 0.6, cacheRead: 0.075 } },
  { pattern: modelId('o3'), rates: { input: 2, output: 8, cacheRead: 0.5 } },
  { pattern: modelId('o4-mini'), rates: { input: 1.1, output: 4.4, cacheRead: 0.275 } },
  // Google: ai.google.dev/gemini-api/docs/pricing. Output includes thinking tokens.
  {
    pattern: modelId('gemini-3\\.[68]-flash'),
    rates: { input: 0.75, output: 3.75, cacheRead: 0.075 },
    changes: [{ from: '2027-01-01', rates: { input: 1.5, output: 7.5, cacheRead: 0.15 } }],
  },
  { pattern: modelId('gemini-3\\.5-flash-lite'), rates: { input: 0.3, output: 2.5, cacheRead: 0.03 } },
  { pattern: modelId('gemini-3\\.1-flash-lite'), rates: { input: 0.25, output: 1.5, cacheRead: 0.025 } },
  {
    pattern: modelId('gemini-3\\.1-pro-preview'),
    rates: { input: 2, output: 12, cacheRead: 0.2 },
    longContext: { above: 200_000, rates: { input: 4, output: 18, cacheRead: 0.4 } },
  },
  {
    pattern: modelId('gemini-2\\.5-pro'),
    rates: { input: 1.25, output: 10, cacheRead: 0.125 },
    longContext: { above: 200_000, rates: { input: 2.5, output: 15, cacheRead: 0.25 } },
  },
  { pattern: modelId('gemini-2\\.5-flash'), rates: { input: 0.3, output: 2.5, cacheRead: 0.03 } },
  { pattern: modelId('gemini-2\\.5-flash-lite'), rates: { input: 0.1, output: 0.4, cacheRead: 0.01 } },
];

/** An exact model id, allowing a `vendor/` prefix and a date or `-latest` suffix. */
function modelId(body: string): RegExp {
  return new RegExp(`(?:^|/)${body}(?:-\\d{4}-?\\d{2}-?\\d{2}|-latest)?$`);
}

/** The tokens of one model call, split the way providers bill them. */
export interface CallTokens {
  /** Every prompt token, including cache reads and writes. */
  input: number;
  /** Every billed output token, including reasoning or thinking. */
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
}

/** Whether the table covers a model. */
export function isPriced(model: string): boolean {
  return MODEL_PRICES.some(({ pattern }) => pattern.test(model));
}

/**
 * Dollars for one call at list price, or undefined when the table does not
 * cover the model. Each call is priced on its own, because a long prompt
 * moves that one request, and only that request, to the long-context rates.
 */
export function listPriceOf(model: string, tokens: CallTokens, at: Date, multiplier = 1): number | undefined {
  const entry = MODEL_PRICES.find(({ pattern }) => pattern.test(model));
  if (!entry) {
    return undefined;
  }
  const rates = ratesFor(entry, tokens.input, at);
  const cached = tokens.cacheRead + tokens.cacheWrite + tokens.cacheWrite1h;
  const fresh = Math.max(0, tokens.input - cached);
  const dollars =
    fresh * rates.input +
    tokens.cacheRead * (rates.cacheRead ?? rates.input) +
    tokens.cacheWrite * (rates.cacheWrite ?? rates.input) +
    tokens.cacheWrite1h * (rates.cacheWrite1h ?? rates.cacheWrite ?? rates.input) +
    tokens.output * rates.output;
  return (dollars * multiplier) / 1_000_000;
}

function ratesFor(entry: PriceEntry, promptTokens: number, at: Date): Rates {
  if (entry.longContext && promptTokens > entry.longContext.above) {
    return entry.longContext.rates;
  }
  const day = at.toISOString().slice(0, 10);
  const changed = (entry.changes ?? []).filter((change) => change.from <= day).at(-1);
  return changed?.rates ?? entry.rates;
}
