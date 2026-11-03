import { ancestors, incomingEdges, outgoingEdges } from './graph-utils';
import type { AgentNode, Graph } from './types';

export type LintCode =
  | 'json-via-web-fetch'
  | 'no-exact-endpoint'
  | 'qualitative-branch'
  | 'downstream-reads-input'
  | 'rigid-deliverable'
  | 'concurrent-write'
  | 'parallel-limit-one';

/**
 * A design warning, not a malformed document. Warnings never affect
 * `validate`'s exit code: a flow may ship with them.
 */
export interface LintWarning {
  severity: 'warning';
  code: LintCode;
  message: string;
  /** The suggested repair, phrased for the agent that wrote the flow. */
  hint: string;
  nodeId?: string;
}

// Non-global: `.test()` on a /g regex advances lastIndex and makes results
// depend on call order.
const URL_PATTERN = /https?:\/\/[^\s'"`)\]]+/;
const JSON_API_PATTERN = /\/api\/|\.json\b|algolia\.com/;
const CURL_PATTERN = /\bcurl\b/;
const WRITE_PATH_PATTERN = /[\w./-]+\.(?:json|md|txt|csv|jsonl)\b/g;
const NUMERIC_PATTERN = /\d|>\s*=?|<\s*=?|points|score|count|threshold|length/i;
const INPUT_PATTERN = /--input\b|the run input|initial input|the user'?s request/i;
const FETCH_PATTERN = /\b(curl|wget|web_fetch|https?:\/\/|api|download|fetch)\b/i;
const RIGID_DELIVERABLE_PATTERN = /exactly this shape|exactly as written|in exactly this format|only `?- `? bullets/i;

interface LintContextInternal {
  graph: Graph;
  node: AgentNode;
}

type Rule = (context: LintContextInternal) => LintWarning[];

const RULES: Rule[] = [
  jsonViaWebFetch,
  noExactEndpoint,
  qualitativeBranch,
  downstreamReadsInput,
  rigidDeliverable,
  concurrentWrite,
];

/**
 * Design lint for a flow document. Pure: no model calls, no network, no run.
 * Every rule is a heuristic over the prompt text, permissions and wiring, and
 * is motivated by a measured cost or determinism failure.
 */
export function lintGraph(graph: Graph): LintWarning[] {
  const warnings: LintWarning[] = [];
  for (const node of graph.nodes) {
    for (const rule of RULES) {
      warnings.push(...rule({ graph, node }).filter((warning) => !ignored(node, warning.code)));
    }
  }
  return warnings;
}

/**
 * A warning about the run settings rather than the document. LangGraph's
 * scheduler stops starting the nodes of a step once nothing is running, so with
 * MAX_PARALLEL_NODES at 1 a step of two or more nodes runs only its first, and
 * the run still reports "completed". A step holds two or more nodes when the
 * flow has two entry nodes or a node with several outgoing edges (a branch
 * node starts every successor; the ones not taken record a skip).
 */
export function lintParallelLimit(graph: Graph, maxParallelNodes: number): LintWarning[] {
  if (maxParallelNodes > 1) {
    return [];
  }
  const entries = graph.nodes.filter((node) => incomingEdges(graph, node.id).length === 0);
  const forks = graph.nodes.filter((node) => outgoingEdges(graph, node.id).length > 1);
  if (entries.length < 2 && forks.length === 0) {
    return [];
  }
  const where = entries.length >= 2 ? `this flow has ${entries.length} entry nodes` : `"${forks[0]?.label}" has several outgoing edges`;
  return [
    {
      severity: 'warning',
      code: 'parallel-limit-one',
      message:
        `MAX_PARALLEL_NODES is ${maxParallelNodes}, and ${where}, so two nodes can be ready at once. ` +
        'At 1, a run stops after the first of them and still reports "completed", without their outputs.',
      hint: 'Set MAX_PARALLEL_NODES to 2 or more in the settings file, then restart the server or run the command again.',
    },
  ];
}

function ignored(node: AgentNode, code: LintCode): boolean {
  return node.lintIgnore?.includes(code) ?? false;
}

function jsonViaWebFetch({ node }: LintContextInternal): LintWarning[] {
  const prompt = node.prompt;
  const suspicious =
    node.permissions.web && /web_fetch/.test(prompt) && JSON_API_PATTERN.test(prompt) && !CURL_PATTERN.test(prompt);

  if (!suspicious) {
    return [];
  }
  const repair = node.permissions.bash
    ? 'Prefer run_bash with `curl -s <url> | jq \'<fields>\'`.'
    : 'Fetch it with web_fetch, but trim the payload server-side with the API\'s query parameters and ask for only the fields you need. Keep bash on a node that already needs shell access.';
  return [
    warning(
      node,
      'json-via-web-fetch',
      `Node "${label(node)}" uses web_fetch for a JSON API.`,
      `${repair} Tool results are re-sent on every iteration, so a raw JSON payload is paid for repeatedly.`,
    ),
  ];
}

function noExactEndpoint({ node }: LintContextInternal): LintWarning[] {
  const fetches =
    node.permissions.web || node.permissions.browser || (node.permissions.bash && FETCH_PATTERN.test(node.prompt));
  if (!fetches || URL_PATTERN.test(node.prompt)) {
    return [];
  }
  return [
    warning(
      node,
      'no-exact-endpoint',
      `Node "${label(node)}" can fetch, but names no exact endpoint.`,
      'Bake in the endpoint, the query and the fields to read. "Get the news" invites a search loop; a full URL does not.',
    ),
  ];
}

function qualitativeBranch({ graph, node }: LintContextInternal): LintWarning[] {
  const outgoing = outgoingEdges(graph, node.id);
  if (outgoing.length < 2 || node.fanout === 'parallel') {
    return [];
  }

  const conditions = outgoing.map((edge) => edge.condition ?? '').join(' ');
  if (NUMERIC_PATTERN.test(conditions) || NUMERIC_PATTERN.test(node.prompt)) {
    return [];
  }
  return [
    warning(
      node,
      'qualitative-branch',
      `Node "${label(node)}" branches on a qualitative condition.`,
      'Make the decision a mechanical predicate over fetched values (a count, a threshold, a regex match) so it lands on the same branch every run.',
    ),
  ];
}

function downstreamReadsInput({ graph, node }: LintContextInternal): LintWarning[] {
  const isEntry = incomingEdges(graph, node.id).length === 0;
  if (isEntry || !INPUT_PATTERN.test(node.prompt)) {
    return [];
  }
  if (node.inputs?.includes('$input')) {
    return [];
  }
  return [
    warning(
      node,
      'downstream-reads-input',
      `Node "${label(node)}" refers to the run input, but it has upstream nodes.`,
      'Only entry nodes see --input; downstream nodes see their declared inputs, and declaring `inputs` replaces the default predecessor handoffs. Name both: `"inputs": ["<producer id>", "$input"]`. Or move the value into this node\'s prompt.',
    ),
  ];
}

function rigidDeliverable({ node }: LintContextInternal): LintWarning[] {
  if (node.audience !== 'person') {
    return [];
  }
  const schema = node.outputSchema;
  const shapeChecked =
    schema?.linePattern !== undefined || schema?.minLines !== undefined || schema?.maxLines !== undefined;
  if (!shapeChecked && !RIGID_DELIVERABLE_PATTERN.test(node.prompt)) {
    return [];
  }
  return [
    warning(
      node,
      'rigid-deliverable',
      `Node "${label(node)}" is read by a person, but a template or a line check fixes its output.`,
      'A template writes the framing for the model, and a line check caps each thought at one line. Describe the reader, the purpose and the register instead, and keep shape checks for output a machine consumes.',
    ),
  ];
}

function concurrentWrite({ graph, node }: LintContextInternal): LintWarning[] {
  const paths = writePathsIn(node.prompt);
  if (paths.length === 0) {
    return [];
  }
  const nodeAncestors = ancestors(graph, node.id);

  for (const other of graph.nodes) {
    if (other.id === node.id) {
      continue;
    }
    const concurrent =
      !nodeAncestors.has(other.id) &&
      !ancestors(graph, other.id).has(node.id) &&
      !mutuallyExclusive(graph, node, other);
    if (!concurrent) {
      continue;
    }
    const shared = paths.find((path) => writePathsIn(other.prompt).includes(path));
    if (shared) {
      return [
        warning(
          node,
          'concurrent-write',
          `Nodes "${label(node)}" and "${label(other)}" may run at the same time and both write ${shared}.`,
          'The workspace is shared. Give each node its own path so a parallel run cannot clobber the other.',
        ),
      ];
    }
  }

  return [];
}


/**
 * True when `a` and `b` sit behind different edges of the same branch node, so
 * only one of them can run on any path. Parallel fan-out takes every edge, so
 * it never makes its targets exclusive.
 */
function mutuallyExclusive(graph: Graph, a: AgentNode, b: AgentNode): boolean {
  for (const branch of graph.nodes) {
    if (outgoingEdges(graph, branch.id).length < 2 || branch.fanout === 'parallel') {
      continue;
    }
    const aIndex = branchIndex(graph, branch, a.id);
    const bIndex = branchIndex(graph, branch, b.id);
    if (aIndex !== undefined && bIndex !== undefined && aIndex !== bIndex) {
      return true;
    }
  }
  return false;
}

/** The outgoing edge of `branch` that leads to `nodeId`, when exactly one does. */
function branchIndex(graph: Graph, branch: AgentNode, nodeId: string): number | undefined {
  const reachable = ancestors(graph, nodeId);
  const indexes = outgoingEdges(graph, branch.id).flatMap((edge, index) =>
    edge.target === nodeId || reachable.has(edge.target) ? [index] : [],
  );
  return indexes.length === 1 ? indexes[0] : undefined;
}

function writePathsIn(prompt: string): string[] {
  return [...new Set((prompt.match(WRITE_PATH_PATTERN) ?? []).filter((path) => !URL_PATTERN.test(path)))];
}

function warning(node: AgentNode, code: LintCode, message: string, hint: string): LintWarning {
  return { severity: 'warning', code, message, hint, nodeId: node.id };
}

function label(node: AgentNode): string {
  return node.label.trim() || node.id;
}
