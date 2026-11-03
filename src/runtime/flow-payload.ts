import { randomUUID } from 'node:crypto';
import { readPermissions } from '../domain/permissions';
import {
  PROVIDER_IDS,
  type AgentNode,
  type Fanout,
  type GraphEdge,
  type GraphPayload,
  type GraphViewport,
  type OutputSchema,
  type ProviderId,
} from '../domain/types';

/** A flow document that is not structurally valid JSON for this schema. */
export class FlowFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowFormatError';
  }
}

/**
 * Structural parsing only. Domain rules (entry node, reachability, required
 * fields) are reported by `validateGraph`, so a caller can inspect a draft
 * before it is runnable.
 */
export function parseFlowPayload(body: unknown): GraphPayload {
  const record = expectRecord(body, 'body');

  return {
    name: optionalString(record.name) ?? 'Untitled automation',
    nodes: expectArray(record.nodes, 'nodes').map(parseNode),
    edges: expectArray(record.edges, 'edges').map(parseEdge),
    viewport: parseViewport(record.viewport),
  };
}

function parseNode(value: unknown, index: number): AgentNode {
  const path = `nodes[${index}]`;
  const record = expectRecord(value, path);
  const provider = expectString(record.provider, `${path}.provider`);

  if (!PROVIDER_IDS.includes(provider as ProviderId)) {
    throw new FlowFormatError(`${path}.provider must be one of: ${PROVIDER_IDS.join(', ')}.`);
  }

  return {
    id: optionalString(record.id) ?? randomUUID(),
    label: optionalString(record.label) ?? '',
    provider: provider as ProviderId,
    model: optionalString(record.model) ?? '',
    prompt: optionalString(record.prompt) ?? '',
    permissions: readPermissions(expectRecord(record.permissions ?? {}, `${path}.permissions`)),
    position: parsePosition(record.position, `${path}.position`),
    outputSchema: parseOutputSchema(record.outputSchema, `${path}.outputSchema`),
    lintIgnore: optionalStringArray(record.lintIgnore, `${path}.lintIgnore`),
    inputs: optionalStringArray(record.inputs, `${path}.inputs`),
    needs: optionalString(record.needs),
    fanout: optionalFanout(record.fanout),
    audience: optionalAudience(record.audience, `${path}.audience`),
    maxIterations: optionalPositiveInteger(record.maxIterations, `${path}.maxIterations`),
    waitForJobs: optionalBoolean(record.waitForJobs, `${path}.waitForJobs`),
  };
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new FlowFormatError(`${path} must be true or false.`);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, path: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new FlowFormatError(`${path} must be a whole number of model calls, 1 or more.`);
  }
  return value;
}

/**
 * `audience` has exactly one value, so an unknown one is a mistake rather than
 * a draft: rejecting it names the typo instead of silently dropping the marker.
 */
function optionalAudience(value: unknown, path: string): 'person' | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === 'person') {
    return 'person';
  }
  throw new FlowFormatError(`${path} must be "person" when set.`);
}

function optionalFanout(value: unknown): Fanout | undefined {
  return value === 'branch' || value === 'parallel' ? value : undefined;
}

function parseOutputSchema(value: unknown, path: string): OutputSchema | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const record = expectRecord(value, path);
  const schema: OutputSchema = {};

  if (typeof record.minLines === 'number') {
    schema.minLines = record.minLines;
  }
  if (typeof record.maxLines === 'number') {
    schema.maxLines = record.maxLines;
  }

  const linePattern = optionalString(record.linePattern);
  if (linePattern !== undefined) {
    schema.linePattern = linePattern;
  }
  const linePatternHint = optionalString(record.linePatternHint);
  if (linePatternHint !== undefined) {
    schema.linePatternHint = linePatternHint;
  }

  const mustContain = optionalStringArray(record.mustContain, `${path}.mustContain`);
  if (mustContain !== undefined) {
    schema.mustContain = mustContain;
  }
  const mustNotContain = optionalStringArray(record.mustNotContain, `${path}.mustNotContain`);
  if (mustNotContain !== undefined) {
    schema.mustNotContain = mustNotContain;
  }

  return schema;
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new FlowFormatError(`${path} must be an array of strings.`);
  }
  return value.map((entry, index) => expectString(entry, `${path}[${index}]`));
}

function parseEdge(value: unknown, index: number): GraphEdge {
  const path = `edges[${index}]`;
  const record = expectRecord(value, path);

  return {
    id: optionalString(record.id) ?? randomUUID(),
    source: expectString(record.source, `${path}.source`),
    target: expectString(record.target, `${path}.target`),
    branch: optionalString(record.branch),
    condition: optionalString(record.condition) ?? '',
  };
}

function parsePosition(value: unknown, path: string): { x: number; y: number } {
  if (value === undefined || value === null) {
    return { x: 0, y: 0 };
  }
  const record = expectRecord(value, path);
  return { x: expectNumber(record.x, `${path}.x`), y: expectNumber(record.y, `${path}.y`) };
}

function parseViewport(value: unknown): GraphViewport | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const record = expectRecord(value, 'viewport');
  return {
    x: expectNumber(record.x, 'viewport.x'),
    y: expectNumber(record.y, 'viewport.y'),
    zoom: expectNumber(record.zoom, 'viewport.zoom'),
  };
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FlowFormatError(`"${path}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new FlowFormatError(`"${path}" must be an array.`);
  }
  return value;
}

function expectString(value: unknown, path: string): string {
  const parsed = optionalString(value);
  if (parsed === undefined) {
    throw new FlowFormatError(`"${path}" must be a string.`);
  }
  return parsed;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FlowFormatError(`"${path}" must be a finite number.`);
  }
  return value;
}
