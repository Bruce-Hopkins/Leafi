/** What a model reasoned on one response, as OpenRouter returns it. */
interface Reasoning {
  text?: string;
  details?: unknown[];
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Carries a model's reasoning from one step to the next on OpenRouter.
 *
 * OpenRouter returns reasoning on each assistant message (`reasoning`, and the
 * structured `reasoning_details`) and asks for it back during tool use; DeepSeek
 * requires it. `@langchain/openai` neither reads nor sends those fields, so
 * this wraps the OpenRouter client's `fetch`: it remembers each response's
 * reasoning by its tool-call ids, attaches it to the matching assistant message
 * on later requests, and copies the text to `reasoning_content`, the one field
 * the library does keep, so the run can record it.
 *
 * One relay serves one node's model, so its memory lasts exactly one node run.
 */
export class ReasoningRelay {
  private readonly byToolCall = new Map<string, Reasoning>();

  constructor(private readonly base: Fetch = (input, init) => fetch(input, init)) {}

  readonly fetch: Fetch = async (input, init) => {
    const response = await this.base(input, this.withReasoning(init));
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) {
      return response;
    }
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return rebuilt(response, text);
    }
    this.remember(body);
    return rebuilt(response, JSON.stringify(body));
  };

  /** Adds remembered reasoning to each earlier assistant message that called tools. */
  private withReasoning(init: RequestInit | undefined): RequestInit | undefined {
    if (typeof init?.body !== 'string' || this.byToolCall.size === 0) {
      return init;
    }
    let body: { messages?: unknown };
    try {
      body = JSON.parse(init.body) as { messages?: unknown };
    } catch {
      return init;
    }
    if (!Array.isArray(body.messages)) {
      return init;
    }
    let changed = false;
    for (const message of body.messages as Record<string, unknown>[]) {
      const reasoning = message.role === 'assistant' ? this.byToolCall.get(firstToolCallId(message) ?? '') : undefined;
      if (!reasoning) {
        continue;
      }
      if (reasoning.details && reasoning.details.length > 0) {
        message.reasoning_details = reasoning.details;
      } else if (reasoning.text) {
        message.reasoning = reasoning.text;
      }
      changed = true;
    }
    return changed ? { ...init, body: JSON.stringify(body) } : init;
  }

  private remember(body: unknown): void {
    const choices = (body as { choices?: unknown }).choices;
    if (!Array.isArray(choices)) {
      return;
    }
    for (const choice of choices as { message?: Record<string, unknown> }[]) {
      const message = choice.message;
      if (!message) {
        continue;
      }
      const text = typeof message.reasoning === 'string' && message.reasoning.length > 0 ? message.reasoning : undefined;
      const details = Array.isArray(message.reasoning_details) ? message.reasoning_details : undefined;
      if (!text && !details) {
        continue;
      }
      if (text && message.reasoning_content === undefined) {
        message.reasoning_content = text;
      }
      const id = firstToolCallId(message);
      if (id) {
        this.byToolCall.set(id, { ...(text ? { text } : {}), ...(details ? { details } : {}) });
      }
    }
  }
}

function firstToolCallId(message: Record<string, unknown>): string | undefined {
  const calls = message.tool_calls;
  if (!Array.isArray(calls)) {
    return undefined;
  }
  const id = (calls[0] as { id?: unknown } | undefined)?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/** The same response with a new body; length and encoding headers described the old one. */
function rebuilt(response: Response, body: string): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
