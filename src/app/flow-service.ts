import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import type { Graph, GraphPayload } from '../domain/types';
import { parseFlowPayload } from '../runtime/flow-payload';

/** A flow could not be read or parsed. */
export class FlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowError';
  }
}

export class FlowService {
  async loadPath(source: string): Promise<Graph> {
    return this.toGraph(parseFlow(await readFlowText(source)));
  }

  async loadText(text: string): Promise<Graph> {
    return this.toGraph(parseFlow(text));
  }

  loadPayload(body: unknown): Graph {
    return this.toGraph(parseFlowPayload(body));
  }

  /**
   * A CLI flow is never persisted, so the runtime-owned fields are synthesized.
   * The graph id only appears in the run record.
   */
  toGraph(payload: GraphPayload): Graph {
    const now = new Date().toISOString();
    return { ...payload, id: randomUUID(), createdAt: now, updatedAt: now };
  }
}

export function parseFlow(text: string): GraphPayload {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new FlowError('The flow is not valid JSON.');
  }
  return parseFlowPayload(body);
}

export async function readFlowText(source: string): Promise<string> {
  if (source === '-') {
    return readStdin();
  }
  try {
    return await fs.readFile(source, 'utf8');
  } catch {
    throw new FlowError(`Could not read the flow file "${source}".`);
  }
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}
