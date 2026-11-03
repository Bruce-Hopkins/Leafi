import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeConfig } from '../config/runtime-config';
import { childPath } from '../domain/paths';
import type { Graph, Run, RunEvent, RunSource } from '../domain/types';

/** Run records hold inputs, outputs, tool calls and email excerpts: owner-only. */
export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/**
 * Run artifacts under the configured data directory. A run is never loaded from
 * outside this directory, and no process marks another process's run as failed:
 * two CLI invocations may legitimately be running at the same time.
 */
export class RunStore {
  constructor(private readonly config: RuntimeConfig) {}

  async ensureLayout(): Promise<void> {
    for (const dir of [this.config.dataDir, this.config.runsDir, this.config.workspacesDir]) {
      await fs.mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
      // `mode` only applies to directories mkdir creates; tighten ones from older releases too.
      // A directory owned by someone else cannot be changed, and is left as it is.
      await fs.chmod(dir, PRIVATE_DIR_MODE).catch(() => undefined);
    }
  }

  createRun(graph: Graph, input: string, source: RunSource): Run {
    return {
      id: randomUUID(),
      graphId: graph.id,
      graphName: graph.name,
      input,
      source,
      status: 'running',
      outputs: {},
      startedAt: new Date().toISOString(),
    };
  }

  async createRunWorkspace(runId: string): Promise<string> {
    const workspace = this.requireContained(this.config.workspacesDir, runId);
    await fs.mkdir(workspace, { recursive: true, mode: PRIVATE_DIR_MODE });
    return workspace;
  }

  async writeRun(run: Run): Promise<void> {
    await this.writeJson(this.runFile(run.id), run);
  }

  async readRun(id: string): Promise<Run | null> {
    const dir = childPath(this.config.runsDir, id);
    return dir ? this.readJson<Run>(path.join(dir, 'meta.json')) : null;
  }

  async requireRun(id: string): Promise<Run> {
    const run = await this.readRun(id);
    if (!run) {
      throw new Error(`No run with id "${id}".`);
    }
    return run;
  }

  async listRuns(): Promise<Run[]> {
    const entries = await this.readdir(this.config.runsDir);
    const runs: Run[] = [];
    for (const entry of entries) {
      const run = await this.readRun(entry);
      if (run) {
        runs.push(run);
      }
    }
    return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async readEvents(runId: string): Promise<RunEvent[]> {
    const dir = childPath(this.config.runsDir, runId);
    const raw = dir ? await this.readText(path.join(dir, 'events.jsonl')) : null;
    if (!raw) {
      return [];
    }
    return raw
      .split('\n')
      .flatMap((line) => (line.trim() ? [parseEvent(line)] : []))
      .filter((event): event is RunEvent => event !== null)
      .sort((a, b) => a.seq - b.seq);
  }

  eventsFile(runId: string): string {
    return path.join(this.requireContained(this.config.runsDir, runId), 'events.jsonl');
  }

  private runFile(id: string): string {
    return path.join(this.requireContained(this.config.runsDir, id), 'meta.json');
  }

  /** A run id names a directory below `root`; anything that resolves elsewhere is not a run. */
  private requireContained(root: string, id: string): string {
    const resolved = childPath(root, id);
    if (!resolved) {
      throw new Error(`Invalid run id "${id}".`);
    }
    return resolved;
  }

  private async readdir(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(dir);
    } catch {
      return [];
    }
  }

  private async readText(file: string): Promise<string | null> {
    try {
      return await fs.readFile(file, 'utf8');
    } catch {
      return null;
    }
  }

  private async readJson<T>(file: string): Promise<T | null> {
    const raw = await this.readText(file);
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: PRIVATE_DIR_MODE });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
    await fs.rename(temporary, file);
  }
}

function parseEvent(line: string): RunEvent | null {
  try {
    return JSON.parse(line) as RunEvent;
  } catch {
    return null;
  }
}
