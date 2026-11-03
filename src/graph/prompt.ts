import { findNode, incomingEdges, outgoingEdges, type Handoff } from '../domain/graph-utils';
import { describeOutputSchema, hasOutputSchema } from '../domain/output-schema';
import type { AgentNode, Graph } from '../domain/types';
import type { RunState } from './run-state';

export interface AgentContext {
  workspaceRoot: string;
  platform: string;
}

/** The run-input placeholder a node can name in `inputs`. */
export const RUN_INPUT = '$input';

export function buildSystemPrompt(
  graph: Graph,
  node: AgentNode,
  handoffs: Handoff[],
  context: AgentContext,
): string {
  const isPerson = node.audience === 'person';
  return [
    'You are an autonomous agent that can complete tasks and write code.',
    `You are working in the folder ${context.workspaceRoot} on ${context.platform}.`,
    'File tools take paths relative to that folder; shell commands run with it as the working directory.',
    '',
    `You are "${node.label}", one agent node inside a larger automation graph.`,
    isPerson
      ? 'Your output is the final result of this run, and a person reads it. There is no one to ask mid-task.'
      : 'Do your part well, then hand off. There is no one to ask mid-task.',
    ...whereYouSit(graph, node),
    '',
    '# Your task',
    node.prompt.trim(),
    ...requiredOutputSection(node),
    '# Finishing',
    ...finishingInstructions(graph, node, handoffs),
  ].join('\n');
}

/** Who consumes this node's output, and what it receives — from the graph, not prose. */
function whereYouSit(graph: Graph, node: AgentNode): string[] {
  const successors = outgoingEdges(graph, node.id)
    .map((edge) => findNode(graph, edge.target))
    .filter((candidate): candidate is AgentNode => candidate !== undefined);
  const producers = declaredInputIds(graph, node)
    .filter((id) => id !== RUN_INPUT)
    .map((id) => findNode(graph, id))
    .filter((candidate): candidate is AgentNode => candidate !== undefined);

  if (successors.length === 0 && producers.length === 0) {
    return [];
  }

  const lines = ['', '# Where you sit'];
  if (node.audience === 'person') {
    lines.push('Your output goes to: the person who ran this flow.');
  }
  for (const successor of successors) {
    lines.push(`Your output goes to: "${successor.label}" — ${consumerNeed(successor)}.`);
  }
  for (const producer of producers) {
    lines.push(`You receive: "${producer.label}"${producerSummary(producer)}.`);
  }
  return lines;
}

function consumerNeed(node: AgentNode): string {
  if (node.needs?.trim()) {
    return node.needs.trim();
  }
  if (node.audience === 'person') {
    return 'it writes the final result for a person from your output, so hand over the substance (specifics, numbers, names, claims), not labels';
  }
  if (hasOutputSchema(node.outputSchema)) {
    return describeOutputSchema(node.outputSchema).join(' ');
  }
  return 'it uses your output as its input';
}

function producerSummary(node: AgentNode): string {
  if (hasOutputSchema(node.outputSchema)) {
    return ` (${describeOutputSchema(node.outputSchema).join(' ')})`;
  }
  return '';
}

/** The node ids whose handoffs this node receives, honouring `inputs` when present. */
export function declaredInputIds(graph: Graph, node: AgentNode): string[] {
  if (node.inputs !== undefined) {
    return node.inputs;
  }
  return incomingEdges(graph, node.id).map((edge) => edge.source);
}

/** The node's enforced output shape, when it has one, as prompt text. */
function requiredOutputSection(node: AgentNode): string[] {
  if (!hasOutputSchema(node.outputSchema)) {
    return [];
  }
  return ['', '# Required output shape', ...describeOutputSchema(node.outputSchema), ''];
}

function finishingInstructions(graph: Graph, node: AgentNode, handoffs: Handoff[]): string[] {
  const outputBullet =
    node.audience === 'person'
      ? '- `output`: the finished result, exactly as the person who ran this flow should read it. Nothing rewrites it after you.'
      : '- `output`: what downstream nodes receive. Give them everything they need to do their part well, and nothing they don\'t; make it self-contained, as they never see this conversation.';
  const lines = ['When — and only when — the task is done, call `complete_task` with:', outputBullet];

  if (node.fanout === 'parallel' && handoffs.length > 1) {
    const targets = outgoingEdges(graph, node.id)
      .map((edge) => findNode(graph, edge.target)?.label ?? edge.target)
      .join('", "');
    lines.push(`Your output is handed to all of: "${targets}" — they run in parallel.`);
    const conditions = [...new Set(handoffs.map((handoff) => handoff.condition).filter((value) => value.length > 0))];
    if (conditions.length > 0) {
      lines.push(`You are finished only when: ${conditions.join('; ')}`);
    }
    lines.push('Do not pass `next`: this node does not choose a branch.');
    lines.push('If the task is not done yet, keep working with your tools instead of finishing early.');
    return lines;
  }

  if (handoffs.length > 1) {
    lines.push('- `next`: the branch to take. Choose the one whose condition matches the outcome:');
    for (const handoff of handoffs) {
      lines.push(`  - "${handoff.name}" — ${handoff.condition || 'no condition given'}`);
    }
  } else if (handoffs[0]?.condition) {
    lines.push(`You are finished only when: ${handoffs[0].condition}`);
  }

  lines.push('If the task is not done yet, keep working with your tools instead of finishing early.');
  return lines;
}

export function buildNodeInput(graph: Graph, node: AgentNode, state: RunState): string {
  const sources = declaredInputIds(graph, node);
  const isEntry = incomingEdges(graph, node.id).length === 0;

  if (sources.length === 0) {
    if (isEntry) {
      return runInputSection(state);
    }
    return '# Input from upstream agents\n\n(No handoff text was requested for this node.)';
  }

  const sections = ['# Input from upstream agents'];

  for (const id of sources) {
    if (id === RUN_INPUT) {
      sections.push(runInputSection(state));
      continue;
    }
    const sourceLabel = findNode(graph, id)?.label ?? id;
    const output = state.outputs[id];
    if (output === undefined) {
      sections.push(`## ${sourceLabel}`, '(not run on this path)');
      continue;
    }
    if (state.stoppedEarly?.[id]) {
      sections.push(
        `## ${sourceLabel}`,
        '(This node ran out of model calls before finishing, so its output below is partial. Treat anything it does not report as not done.)',
        output,
      );
      continue;
    }
    sections.push(`## ${sourceLabel}`, output);
  }

  if (sections.length === 1) {
    sections.push('(No upstream agent produced output on this run.)');
  }

  return sections.join('\n\n');
}

function runInputSection(state: RunState): string {
  return ['# Run input', state.input.trim() || '(no initial input was provided)'].join('\n');
}
