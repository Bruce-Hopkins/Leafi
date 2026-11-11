import { outgoingEdges, findNode, forwardIncoming, isLoopEdge, loopRegion } from './graph-utils';
import type { AgentNode, Graph, MinimumLimits, NodePermissions } from './types';

/**
 * A lower bound on what one node will spend, derived from what its prompt
 * implies. It assumes the node finishes on the first iteration that plausibly
 * completes the work; a real node loops, and every iteration re-sends the whole
 * context so far, so actual spend is higher by an amount that depends on the
 * flow and the model. It counts tokens only: what a run costs in dollars is
 * reported after it runs, from what each call actually used.
 */
export interface NodeMinimum {
  nodeId: string;
  /** Model iterations the prompt implies, capped at `maxNodeIterations`. */
  iterations: number;
  /** Tokens the node's own tool results contribute. */
  toolResultTokens: number;
  /** Tokens re-sent per iteration: system prompt, task, schemas, handoffs. */
  contextTokens: number;
  totalTokens: number;
  /** Most times the node can run when the flow recurses (edge limits); absent when it runs once. */
  maxPasses?: number;
}

export interface FlowMinimum {
  nodes: NodeMinimum[];
  totalTokens: number;
  /** Shown to every consumer, so the lower bound is never read as a forecast. */
  note: string;
}

const MINIMUM_NOTE =
  'Minimum only: a lower bound, not a forecast. It counts one pass of each node; a node with maxPasses can run that many times because of an edge limit. Agents loop and every iteration re-sends the context so far, ' +
  'so a real run spends more, by an amount that varies with the flow and the model. Compare with the run\'s costUsd.';

/** Per-permission tool-schema cost, in tokens. Rough, but ordering-relevant. */
const TOOL_SCHEMA_TOKENS: Record<keyof NodePermissions, number> = {
  read: 60,
  write: 90,
  bash: 150,
  web: 120,
  email_read: 280,
  mcp: 1400,
};
const COMPLETE_TASK_TOKENS = 80;

const CHARS_PER_TOKEN = 4;
const AVG_LINE_CHARS = 100;
const DEFAULT_OUTPUT_LINES = 3;
const AVG_EMAIL_BODY_BYTES = 3 * 1024;
const AVG_PROJECTED_BYTES = 1024;

const SYSTEM_PROMPT_CONTEXT = { workspaceRoot: '<workspace>', platform: '<platform>' };

const BATCH_PATTERN = /single turn|one turn|in one (?:call|turn)|at once|all at once|for every uid|for each uid/i;
const JQ_PATTERN = /\bjq\b/;
const CURL_PATTERN = /\bcurl\b/g;

const TOOL_MENTIONS: { name: string; pattern: RegExp }[] = [
  { name: 'read_file', pattern: /\bread_file\b/g },
  { name: 'write_file', pattern: /\bwrite_file\b/g },
  { name: 'run_bash', pattern: /\brun_bash\b/g },
  { name: 'web_fetch', pattern: /\bweb_fetch\b/g },
  { name: 'email_search', pattern: /\bemail_search\b/g },
  { name: 'email_get_message', pattern: /\bemail_get_message\b/g },
];

/**
 * The minimum tokens a flow implies, without doing any I/O. The
 * arithmetic follows the runtime: every iteration re-sends the whole context so
 * far, so tool results that arrive one turn at a time are paid for repeatedly.
 */
export function minimumGraph(graph: Graph, limits: MinimumLimits): FlowMinimum {
  const nodes = graph.nodes.map((node) => {
    const maxPasses = maxPassesOf(graph, node.id);
    return { ...minimumNode(graph, node, limits), ...(maxPasses > 1 ? { maxPasses } : {}) };
  });
  const totalTokens = nodes.reduce((sum, node) => sum + node.totalTokens, 0);
  return { nodes, totalTokens, note: MINIMUM_NOTE };
}

/** One run, plus one more for every traversal of every limited edge whose loop holds the node. */
function maxPassesOf(graph: Graph, nodeId: string): number {
  return graph.edges
    .filter(isLoopEdge)
    .filter((edge) => loopRegion(graph, edge).has(nodeId))
    .reduce((sum, edge) => sum + (edge.maxTraversals ?? 0), 1);
}

function minimumNode(graph: Graph, node: AgentNode, limits: MinimumLimits): NodeMinimum {
  const prompt = node.prompt;
  const contextTokens = contextTokensFor(graph, node);
  const toolResultTokens = Math.ceil(toolResultBytes(prompt, limits) / CHARS_PER_TOKEN);
  const iterations = Math.min(toolTurns(prompt) + 1, node.maxIterations ?? limits.maxNodeIterations);

  // Iteration i (0-based) carries every tool result from earlier turns.
  const totalTokens = iterations * contextTokens + toolResultTokens * ((iterations * (iterations - 1)) / 2);

  return { nodeId: node.id, iterations, toolResultTokens, contextTokens, totalTokens };
}

function contextTokensFor(graph: Graph, node: AgentNode): number {
  const characters = node.prompt.length + systemPromptChars(graph, node);
  const toolSchemas = Object.entries(TOOL_SCHEMA_TOKENS)
    .filter(([permission]) => node.permissions[permission as keyof NodePermissions])
    .reduce((sum, [, tokens]) => sum + tokens, COMPLETE_TASK_TOKENS);

  return Math.ceil(characters / CHARS_PER_TOKEN) + toolSchemas + handoffTokens(graph, node);
}

/** The system prompt a node receives, as plain text, from the same builder. */
function systemPromptChars(graph: Graph, node: AgentNode): number {
  const successors = outgoingEdges(graph, node.id).map((edge) => findNode(graph, edge.target)).filter(isNode);
  const producers = inputSources(graph, node)
    .map((id) => findNode(graph, id))
    .filter(isNode);
  const lines = [
    'You are an autonomous agent that can complete tasks and write code.',
    `You are working in the folder ${SYSTEM_PROMPT_CONTEXT.workspaceRoot} on ${SYSTEM_PROMPT_CONTEXT.platform}.`,
    'File tools take paths relative to that folder; shell commands run with it as the working directory.',
    '',
    `You are "${node.label}", one agent node inside a larger automation graph.`,
    'Do your part well, then hand off. There is no one to ask mid-task.',
    '',
    '# Your task',
    node.prompt.trim(),
  ];
  for (const successor of successors) {
    lines.push(`Your output goes to: "${successor.label}" — ${successor.needs ?? successor.label}.`);
  }
  for (const producer of producers) {
    lines.push(`You receive: "${producer.label}".`);
  }
  return lines.join('\n').length;
}

function handoffTokens(graph: Graph, node: AgentNode): number {
  return inputSources(graph, node).reduce((sum, id) => {
    const source = findNode(graph, id);
    return sum + (source ? outputTokensOf(source) : 0);
  }, 0);
}

/** Node ids whose handoff the node receives, mirroring `buildNodeInput`. */
function inputSources(graph: Graph, node: AgentNode): string[] {
  if (node.inputs !== undefined) {
    return node.inputs.filter((id) => id !== '$input' && findNode(graph, id) !== undefined);
  }
  return forwardIncoming(graph, node.id).map((edge) => edge.source);
}

function outputTokensOf(node: AgentNode): number {
  const lines = node.outputSchema?.maxLines ?? DEFAULT_OUTPUT_LINES;
  return Math.ceil((lines * AVG_LINE_CHARS) / CHARS_PER_TOKEN);
}

/** Tool turns the prompt implies. A batch instruction collapses per-item calls. */
function toolTurns(prompt: string): number {
  const mentions = TOOL_MENTIONS.map(({ name, pattern }) => ({
    name,
    count: countMatches(prompt, pattern),
  })).filter((entry) => entry.count > 0);

  const total = mentions.reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0) {
    return 0;
  }
  return BATCH_PATTERN.test(prompt) ? mentions.length : total;
}

/** Bytes the node's own tool results add, sized by the tools its prompt names. */
function toolResultBytes(prompt: string, limits: MinimumLimits): number {
  const cap = limits.toolOutputLimitBytes;
  let bytes = 0;

  const emailReads = countMatches(prompt, /\bemail_get_message\b/g);
  if (emailReads > 0) {
    const count = Math.max(emailReads, itemCount(prompt) ?? 1);
    bytes += count * Math.min(AVG_EMAIL_BODY_BYTES, cap);
  }

  const fetchCalls = countMatches(prompt, CURL_PATTERN) + countMatches(prompt, /\bweb_fetch\b/g);
  if (fetchCalls > 0) {
    bytes += fetchCalls * (JQ_PATTERN.test(prompt) ? Math.min(AVG_PROJECTED_BYTES, cap) : cap);
  }

  return bytes;
}

/**
 * Bodies a prompt reads: its own "15 messages"-style count, or the
 * `maxResults: N` it hands the search tool. Without the latter, a node that
 * reads fifteen bodies from a search is costed as one.
 */
function itemCount(prompt: string): number | undefined {
  const match =
    /maxResults[:=]?\s*(\d+)/i.exec(prompt) ??
    /(\d+)\s+(?:newest|latest|most recent|messages|emails|mails|items|stories|results)/i.exec(prompt);
  if (!match) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function countMatches(prompt: string, pattern: RegExp): number {
  return (prompt.match(pattern) ?? []).length;
}

function isNode(value: AgentNode | undefined): value is AgentNode {
  return value !== undefined;
}
