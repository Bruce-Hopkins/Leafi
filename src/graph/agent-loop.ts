import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage, ToolMessage, type AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { checkOutput, MAX_OUTPUT_ATTEMPTS } from '../domain/output-schema';
import type { OutputSchema } from '../domain/types';
import { UsageMeter, type CallRecord } from '../providers/usage-meter';
import { COMPLETE_TASK_TOOL, type NodeToolkit } from '../tools/node-toolkit';
import { pieceEnd } from '../tools/tool-output';
import { NodeFailureError } from './node-failure';

const NUDGE =
  'You did not call a tool. Keep working on the task, then call complete_task once your condition is met.';
const PREVIEW_LENGTH = 400;
/** From this many model calls left, each step tells the node to wrap up. */
const WRAP_UP_CALLS = 3;
/** However full a step is, each later tool result keeps at least this much, so its note survives. */
const MIN_STEP_RESULT_BYTES = 1024;

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  resultPreview: string;
}

export interface AgentLoopOptions {
  nodeId: string;
  model: BaseChatModel;
  toolkit: NodeToolkit;
  systemPrompt: string;
  inputMessage: string;
  branches: string[];
  maxIterations: number;
  signal: AbortSignal;
  /** Charges one step against the run-wide budget; throws when it is exhausted. */
  countStep(): void;
  /** Model calls the whole run has left after those already charged; absent means no run-wide limit. */
  runCallsLeft?(): number;
  onToolCall(record: ToolCallRecord): Promise<void>;
  /** Receives the assistant's text for this iteration, as it decides what to do next. */
  onMessage?(text: string): Promise<void>;
  /** When set, every complete_task output must satisfy this shape. */
  outputSchema?: OutputSchema;
  /** Called each time a complete_task output is rejected. */
  onOutputRejected?(rejection: { attempt: number; violations: string[] }): Promise<void>;
  /** Marks the re-sent prefix for provider prompt caching. */
  promptCaching?: boolean;
  /** Prices every model call; read it even when the loop throws, so spend survives a failure. */
  meter?: UsageMeter;
  /** The most all tool results of one model response may return together. */
  stepOutputLimitBytes?: number;
  /** Receives each model call's figures and reasoning, as it returns. */
  onModelCall?(call: ModelCallRecord): Promise<void>;
  /** How long one model call may take; a call that takes longer is retried once, then fails the node. */
  modelCallTimeoutMs?: number;
  /** Called when a model call ran out of time and is about to be retried. */
  onModelTimeout?(step: number): Promise<void>;
  /** What else each step's note reports: the node's jobs and the run's clock. */
  stepStatus?(): StepStatus;
}

/** The parts of a step note that come from outside the loop. */
export interface StepStatus {
  /** Extra facts for the note, such as `jobs: job-1 running 4m` or `run time left 21m`. */
  parts: string[];
  /** The node holds jobs still running, which it hands on if it finishes now. */
  jobsRunning: boolean;
}

/** One model call, as the run's events record it. */
export interface ModelCallRecord extends Partial<CallRecord> {
  /** 1-based: the call's place in the node's budget. */
  step: number;
  /** The model's reasoning, as text, when the provider returns it. */
  reasoningText?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface AgentLoopResult {
  output: string;
  next?: string;
  /** Tokens the node's model calls consumed, when the provider reports them. */
  usage: TokenUsage;
  /** Model invocations the node needed, including nudged retries. */
  iterations: number;
  /** The node used its last model call and handed over what it had. */
  stoppedEarly?: boolean;
}

/**
 * The bounded loop every node runs: reason, call permitted tools, observe, and
 * stop only when the agent calls `complete_task`. Each step tells the node how
 * many model calls it has left, and the last call offers only `complete_task`,
 * so a node that runs out hands over a partial result instead of nothing.
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { nodeId, model, toolkit, systemPrompt, inputMessage, branches, maxIterations, signal } = options;
  const cacheable = options.promptCaching === true;
  const messages: BaseMessage[] = [
    withCacheControl(new SystemMessage(systemPrompt), cacheable),
    new HumanMessage(inputMessage),
  ];
  const runner = typeof model.bindTools === 'function' ? model.bindTools(toolkit.schemas) : model;
  const finisher = typeof model.bindTools === 'function' ? model.bindTools(finishingSchemas(toolkit)) : model;
  const meter = options.meter ?? new UsageMeter();
  let rejections = 0;

  const done = (completed: Pick<AgentLoopResult, 'output' | 'next'>, stoppedEarly: boolean): AgentLoopResult => {
    const { input, output, total } = meter.summary();
    return {
      ...completed,
      usage: { input, output, total },
      iterations: meter.iterations,
      ...(stoppedEarly ? { stoppedEarly: true } : {}),
    };
  };

  for (let step = 1; step <= maxIterations; step += 1) {
    signal.throwIfAborted();
    options.countStep();
    meter.iterations += 1;
    // Whichever limit is closer, the node's or the run's, decides when the last call is.
    const callsLeft = (): number => Math.min(maxIterations - step, options.runCallsLeft?.() ?? Infinity);
    const last = callsLeft() === 0;

    const outbound = cacheable ? cacheLast(messages) : messages;
    const response = await invokeWithin(last ? finisher : runner, outbound, signal, options, step);
    messages.push(response);
    const figures = meter.record(response);
    const thought = reasoningText(response);
    await options.onModelCall?.({ step, ...figures, ...(thought ? { reasoningText: thought } : {}) });

    const spoken = messageText(response);
    if (spoken.length > 0) {
      await options.onMessage?.(spoken);
    }

    const calls = response.tool_calls ?? [];
    if (last) {
      return done(finalResult(calls, spoken, branches, nodeId, options.outputSchema, maxIterations), true);
    }
    if (calls.length === 0) {
      messages.push(new HumanMessage(NUDGE));
      addStepNote(messages, callsLeft(), step + callsLeft(), options.stepStatus?.());
      continue;
    }

    let stepBytes = 0;
    for (const call of calls) {
      const args = (call.args ?? {}) as Record<string, unknown>;

      if (call.name === COMPLETE_TASK_TOOL) {
        const completed = parseCompleteTask(args, branches, nodeId);
        const violations = options.outputSchema ? checkOutput(options.outputSchema, completed.output) : [];

        if (violations.length > 0) {
          rejections += 1;
          await options.onOutputRejected?.({ attempt: rejections, violations });
          if (rejections >= MAX_OUTPUT_ATTEMPTS) {
            throw new NodeFailureError(
              `complete_task output did not match this node's outputSchema after ${rejections} attempts: ${violations.join('; ')}`,
              nodeId,
            );
          }
          messages.push(
            new ToolMessage({
              content: rejectionMessage(violations),
              tool_call_id: call.id ?? '',
              name: COMPLETE_TASK_TOOL,
            }),
          );
          continue;
        }

        return done(completed, false);
      }

      const result = withinStepLimit(await toolkit.execute(call.name, args), stepBytes, options.stepOutputLimitBytes);
      stepBytes += Buffer.byteLength(result, 'utf8');
      messages.push(new ToolMessage({ content: result, tool_call_id: call.id ?? '', name: call.name }));
      await options.onToolCall({ tool: call.name, args, resultPreview: preview(result) });
    }
    addStepNote(messages, callsLeft(), step + callsLeft(), options.stepStatus?.());
  }

  throw new NodeFailureError(
    `The agent never called complete_task, so it was stopped after ${maxIterations} iterations.`,
    nodeId,
  );
}

/** The last call offers only `complete_task`, so the node can do nothing but hand over. */
function finishingSchemas(toolkit: NodeToolkit): NodeToolkit['schemas'] {
  const finishing = toolkit.schemas.filter((schema) => schema.name === COMPLETE_TASK_TOOL);
  return finishing.length > 0 ? finishing : toolkit.schemas;
}

/**
 * The handover on the last call: its `complete_task`, or, for a node that
 * chooses no branch, the text it wrote instead. Anything else fails the node,
 * because there is no call left to correct it.
 */
function finalResult(
  calls: { name: string; args?: unknown }[],
  spoken: string,
  branches: string[],
  nodeId: string,
  outputSchema: OutputSchema | undefined,
  maxIterations: number,
): Pick<AgentLoopResult, 'output' | 'next'> {
  const finishing = calls.find((call) => call.name === COMPLETE_TASK_TOOL);
  let completed: Pick<AgentLoopResult, 'output' | 'next'> | undefined;
  if (finishing) {
    completed = parseCompleteTask((finishing.args ?? {}) as Record<string, unknown>, branches, nodeId);
  } else if (branches.length === 0 && spoken.trim().length > 0) {
    completed = { output: spoken };
  }
  if (!completed) {
    throw new NodeFailureError(
      `The agent never called complete_task, so it was stopped after ${maxIterations} iterations.`,
      nodeId,
    );
  }
  const violations = outputSchema ? checkOutput(outputSchema, completed.output) : [];
  if (violations.length > 0) {
    throw new NodeFailureError(
      `The agent ran out of model calls, and its last output did not match this node's outputSchema: ${violations.join('; ')}`,
      nodeId,
    );
  }
  return completed;
}

/**
 * Tells the node how many model calls it has left, on the newest message so the
 * earlier conversation, and its cached prefix, stay unchanged.
 */
function addStepNote(messages: BaseMessage[], left: number, budget: number, status?: StepStatus): void {
  const newest = messages.at(-1);
  if (!newest || typeof newest.content !== 'string') {
    return;
  }
  newest.content = `${newest.content}\n\n${stepNote(left, budget, status)}`;
}

/** `left` model calls remain of `budget`, the node's whole allowance on this run. */
export function stepNote(left: number, budget: number, status?: StepStatus): string {
  const head = [`${left} of ${budget} model calls left`, ...(status?.parts ?? [])].join(' · ');
  const jobs = status?.jobsRunning
    ? ' Your running jobs are handed to the next node when you finish; say in complete_task what each one is for and what it will produce.'
    : '';
  if (left <= 1) {
    return `[${head}: the next is your last, and only complete_task will be available. Call complete_task with what you have, and say plainly in it what is unfinished.${jobs}]`;
  }
  if (left <= WRAP_UP_CALLS) {
    return `[${head}. Wrap up: call complete_task soon with what you have, and say plainly in it what is unfinished.${jobs}]`;
  }
  return `[${head}]`;
}

/**
 * One model call, bounded by `modelCallTimeoutMs`: a call that runs out of time
 * is retried once, and a second timeout fails the node, naming the limit. A run
 * cancellation is never retried.
 */
async function invokeWithin(
  model: { invoke(messages: BaseMessage[], options: { signal: AbortSignal }): Promise<AIMessageChunk> },
  messages: BaseMessage[],
  signal: AbortSignal,
  options: AgentLoopOptions,
  step: number,
): Promise<AIMessageChunk> {
  const limit = options.modelCallTimeoutMs;
  if (!limit) {
    return model.invoke(messages, { signal });
  }
  for (let attempt = 1; ; attempt += 1) {
    // A referenced timer, unlike AbortSignal.timeout, keeps the process alive while the call hangs.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), limit);
    try {
      return await model.invoke(messages, { signal: AbortSignal.any([signal, timeout.signal]) });
    } catch (error) {
      if (signal.aborted || !timeout.signal.aborted) {
        throw error;
      }
      if (attempt >= 2) {
        throw new NodeFailureError(
          `The model did not answer within ${limit < 1000 ? `${limit}ms` : `${Math.round(limit / 1000)}s`}, twice in a row (MODEL_CALL_TIMEOUT_MS).`,
          options.nodeId,
        );
      }
      await options.onModelTimeout?.(step);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Cuts a result that would take one response's tool results past their shared limit. */
function withinStepLimit(result: string, used: number, limit: number | undefined): string {
  const size = Buffer.byteLength(result, 'utf8');
  if (!limit || used + size <= limit) {
    return result;
  }
  const room = Math.max(MIN_STEP_RESULT_BYTES, limit - used);
  if (size <= room) {
    return result;
  }
  const buffer = Buffer.from(result, 'utf8');
  const kept = buffer.subarray(0, pieceEnd(buffer, 0, room)).toString('utf8');
  const hidden = size - Buffer.byteLength(kept, 'utf8');
  return `${kept}\n[cut: this response's tool results reached ${limit} bytes together, so the last ${hidden} bytes of this result are not shown. Ask for them in a later response, or read the saved file named above.]`;
}

/** The model's reasoning, where the provider returns it as text. */
function reasoningText(message: BaseMessage): string {
  const kwargs = (message as { additional_kwargs?: Record<string, unknown> }).additional_kwargs;
  if (typeof kwargs?.reasoning_content === 'string') {
    return kwargs.reasoning_content;
  }
  if (!Array.isArray(message.content)) {
    return '';
  }
  return message.content
    .map((block) => {
      const part = block as { type?: string; thinking?: unknown; reasoning?: unknown };
      if (part.type === 'thinking' && typeof part.thinking === 'string') {
        return part.thinking;
      }
      return part.type === 'reasoning' && typeof part.reasoning === 'string' ? part.reasoning : '';
    })
    .filter((text) => text.length > 0)
    .join('\n');
}

function parseCompleteTask(
  args: Record<string, unknown>,
  branches: string[],
  nodeId: string,
): Pick<AgentLoopResult, 'output' | 'next'> {
  const output = args.output;
  if (typeof output !== 'string' || output.trim().length === 0) {
    throw new NodeFailureError('complete_task was called without an output.', nodeId);
  }

  const next = typeof args.next === 'string' ? args.next.trim() : '';
  if (branches.length === 0) {
    return { output };
  }

  if (next.length === 0) {
    throw new NodeFailureError(`complete_task must name a branch: ${branches.join(', ')}.`, nodeId);
  }
  if (!branches.includes(next)) {
    throw new NodeFailureError(`Unknown branch "${next}". Available branches: ${branches.join(', ')}.`, nodeId);
  }

  return { output, next };
}

function rejectionMessage(violations: string[]): string {
  return [
    "complete_task was rejected: the output does not match this node's required output shape.",
    ...violations.map((violation) => `- ${violation}`),
    'Fix the output and call complete_task again with the corrected result.',
  ].join('\n');
}

function preview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > PREVIEW_LENGTH ? `${collapsed.slice(0, PREVIEW_LENGTH)}…` : collapsed;
}

/**
 * Marks a message for Anthropic-style prompt caching. Only string content is
 * annotated: messages carrying tool calls or block content are left untouched,
 * so the marker never changes what the model actually receives.
 */
function withCacheControl(message: BaseMessage, enabled: boolean): BaseMessage {
  if (!enabled || typeof message.content !== 'string' || message.content.length === 0) {
    return message;
  }
  const blocks = [{ type: 'text' as const, text: message.content, cache_control: { type: 'ephemeral' as const } }];

  if (message.type === 'system') {
    return new SystemMessage({ content: blocks });
  }
  if (message.type === 'human') {
    return new HumanMessage({ content: blocks });
  }
  if (message.type === 'tool') {
    const tool = message as ToolMessage;
    return new ToolMessage({ content: blocks, tool_call_id: tool.tool_call_id, name: tool.name });
  }
  return message;
}

/** The latest message is the growing prefix's cache point on the next call. */
function cacheLast(messages: BaseMessage[]): BaseMessage[] {
  const last = messages[messages.length - 1];
  if (!last) {
    return messages;
  }
  return [...messages.slice(0, -1), withCacheControl(last, true)];
}

/** Plain text of an assistant message, skipping tool-call and reasoning blocks. */
function messageText(message: BaseMessage): string {
  const content = message.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((block) => textOfBlock(block))
    .join('')
    .trim();
}

function textOfBlock(block: unknown): string {
  if (typeof block === 'string') {
    return block;
  }
  if (typeof block === 'object' && block !== null) {
    const candidate = block as { type?: unknown; text?: unknown };
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      return candidate.text;
    }
  }
  return '';
}
