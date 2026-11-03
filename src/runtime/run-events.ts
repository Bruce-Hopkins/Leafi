import { randomUUID } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { RunEvent, RunEventType } from '../domain/types';
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE } from './run-store';

export interface RunEventInput {
  nodeId?: string;
  payload?: Record<string, unknown>;
}

export type RunEventListener = (event: RunEvent) => void;

export interface RunEventSinkOptions {
  runId: string;
  /** Omitted when the caller chose not to persist run artifacts. */
  file?: string;
  listener?: RunEventListener;
}

/**
 * Appends events in order and forwards each one to the listener. One write path,
 * so the live feed and the replayed `events.jsonl` always agree.
 */
export class RunEventSink {
  private readonly sequences = new Map<string, number>();
  private stream?: WriteStream;

  private constructor(private readonly options: RunEventSinkOptions) {}

  static async open(options: RunEventSinkOptions): Promise<RunEventSink> {
    const sink = new RunEventSink(options);
    if (options.file) {
      await fs.mkdir(path.dirname(options.file), { recursive: true, mode: PRIVATE_DIR_MODE });
      sink.stream = createWriteStream(options.file, { flags: 'a', mode: PRIVATE_FILE_MODE });
    }
    return sink;
  }

  async record(type: RunEventType, input: RunEventInput = {}): Promise<RunEvent> {
    const runId = this.options.runId;
    const seq = this.sequences.get(runId) ?? 0;
    this.sequences.set(runId, seq + 1);

    const event: RunEvent = {
      id: randomUUID(),
      runId,
      seq,
      type,
      nodeId: input.nodeId,
      payload: input.payload ?? {},
      createdAt: new Date().toISOString(),
    };

    if (this.stream) {
      await writeLine(this.stream, event);
    }
    this.options.listener?.(event);
    return event;
  }

  async close(): Promise<void> {
    const stream = this.stream;
    this.stream = undefined;
    if (stream) {
      await new Promise<void>((resolve) => stream.end(resolve));
    }
  }
}

function writeLine(stream: WriteStream, event: RunEvent): Promise<void> {
  return new Promise((resolve) => {
    stream.write(`${JSON.stringify(event)}\n`, () => resolve());
  });
}

/** The event shape printed by the CLI and returned by the MCP event tool. */
export function toEnvelope(event: RunEvent): Record<string, unknown> {
  return {
    id: event.id,
    runId: event.runId,
    seq: event.seq,
    type: event.type,
    createdAt: event.createdAt,
    ...(event.nodeId ? { nodeId: event.nodeId } : {}),
    ...event.payload,
  };
}
