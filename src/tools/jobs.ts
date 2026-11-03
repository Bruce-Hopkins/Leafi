import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { childEnvironment } from './environment';
import { OWN_PROCESS_GROUP } from './process-tree';
import type { JobStatus, RunJob } from '../domain/types';
import type { Workspace } from './workspace';

/** How often a job whose leader has exited is checked for processes still in its group. */
const GROUP_POLL_MS = 250;
/** The longest delay setTimeout honours. */
const MAX_TIMER_MS = 2 ** 31 - 1;
/** Where job logs live, relative to the workspace root. */
const LOG_DIR = '.jobs';

/** One background job, as the run records it. */
export type JobRecord = RunJob;

export type JobEvent = { type: 'job_started' | 'job_ended'; job: JobRecord };

export interface JobRegistryOptions {
  workspace: Workspace;
  /** The longest any job may run. */
  timeoutMs: number;
  /** When the run itself is stopped, as epoch milliseconds. */
  runDeadline: number;
  onEvent?(event: JobEvent): void;
}

interface Tracked {
  record: JobRecord;
  child?: ChildProcess;
  pgid?: number;
  timer?: NodeJS.Timeout;
  poll?: NodeJS.Timeout;
  ended: Promise<void>;
  finish(status: JobStatus, reason?: string): void;
}

/**
 * The background jobs of one run. Jobs belong to the run, not to the node that
 * started them: a node hands its running jobs to the nodes after it, any node
 * holding a job can wait on it or stop it, and the run stops whatever is still
 * running when it ends.
 */
export class JobRegistry {
  private readonly jobs = new Map<string, Tracked>();
  private counter = 0;

  constructor(private readonly options: JobRegistryOptions) {}

  get timeoutMs(): number {
    return this.options.timeoutMs;
  }

  /** Milliseconds until the run is stopped. */
  runTimeLeftMs(): number {
    return Math.max(0, this.options.runDeadline - Date.now());
  }

  /** Starts `command` in its own process group, its output going to a log in the workspace. */
  async start(command: string, nodeId: string, timeoutMs?: number): Promise<JobRecord> {
    const id = this.nextId();
    const log = path.posix.join(LOG_DIR, `${id}.log`);
    const home = this.options.workspace.root;
    await fsp.mkdir(path.join(home, LOG_DIR), { recursive: true });
    await fsp.mkdir(path.join(home, 'tmp'), { recursive: true });
    const fd = fs.openSync(path.join(home, log), 'a');
    let child: ChildProcess;
    try {
      child = spawn(command, {
        cwd: home,
        shell: process.platform === 'win32' ? true : '/bin/bash',
        env: childEnvironment({ home }),
        detached: OWN_PROCESS_GROUP,
        stdio: ['ignore', fd, fd],
      });
    } finally {
      fs.closeSync(fd);
    }

    const tracked = this.track({ id, command, nodeId, log }, timeoutMs, child, child.pid);
    child.on('error', (error) => {
      fs.appendFile(path.join(home, log), `\n[job could not start: ${error.message}]\n`, () => undefined);
      tracked.finish('exited', `could not start: ${error.message}`);
    });
    child.on('exit', (code) => {
      tracked.record.exitCode = code;
      // The shell can exit while what it started runs on; the job ends with its whole group.
      this.watchGroup(tracked);
    });
    return { ...tracked.record };
  }

  /** Takes on a process group a foreground command left running, so it is tracked and handed on. */
  adopt(pgid: number, command: string, nodeId: string): JobRecord {
    const tracked = this.track({ id: this.nextId(), command, nodeId, adopted: true }, undefined, undefined, pgid);
    this.watchGroup(tracked);
    return { ...tracked.record };
  }

  get(id: string): JobRecord | undefined {
    const tracked = this.jobs.get(id);
    return tracked ? { ...tracked.record } : undefined;
  }

  records(): JobRecord[] {
    return [...this.jobs.values()].map((tracked) => ({ ...tracked.record }));
  }

  /**
   * Waits until every listed job has ended, `ms` has passed, or `signal` aborts.
   * Resolves true when all of them ended.
   */
  async wait(ids: string[], ms: number, signal?: AbortSignal): Promise<boolean> {
    const pending = ids.map((id) => this.jobs.get(id)).filter((tracked): tracked is Tracked => tracked !== undefined);
    if (pending.every((tracked) => tracked.record.status !== 'running')) {
      return true;
    }
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    const all = Promise.all(pending.map((tracked) => tracked.ended)).then(() => true);
    const limit = new Promise<boolean>((resolve) => {
      // setTimeout treats anything past 2^31-1 ms as 1 ms, so a long wait is clamped, not cut short.
      timer = setTimeout(() => resolve(false), Math.min(Math.max(0, ms), MAX_TIMER_MS));
      onAbort = () => resolve(false);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([all, limit]);
    } finally {
      clearTimeout(timer);
      if (onAbort) {
        signal?.removeEventListener('abort', onAbort);
      }
    }
  }

  /** Kills a running job's whole process group. */
  stop(id: string, reason: string): JobRecord | undefined {
    const tracked = this.jobs.get(id);
    if (!tracked) {
      return undefined;
    }
    if (tracked.record.status === 'running') {
      killGroup(tracked);
      tracked.finish('stopped', reason);
    }
    return { ...tracked.record };
  }

  /** Stops every job still running and returns them. */
  stopAll(reason: string): JobRecord[] {
    const stopped: JobRecord[] = [];
    for (const tracked of this.jobs.values()) {
      if (tracked.record.status === 'running') {
        killGroup(tracked);
        tracked.finish('stopped', reason);
        stopped.push({ ...tracked.record });
      }
    }
    return stopped;
  }

  /** The last `bytes` of a job's log, starting on a whole character. */
  async tail(id: string, bytes: number): Promise<string> {
    const log = this.jobs.get(id)?.record.log;
    if (!log) {
      return '';
    }
    const file = path.join(this.options.workspace.root, log);
    let handle: fsp.FileHandle | undefined;
    try {
      handle = await fsp.open(file, 'r');
      const { size } = await handle.stat();
      const start = Math.max(0, size - bytes);
      const buffer = Buffer.alloc(size - start);
      await handle.read(buffer, 0, buffer.byteLength, start);
      let first = 0;
      while (start > 0 && first < 3 && ((buffer[first] ?? 0) & 0xc0) === 0x80) {
        first += 1;
      }
      return buffer.subarray(first).toString('utf8').trimEnd();
    } catch {
      return '';
    } finally {
      await handle?.close();
    }
  }

  private nextId(): string {
    this.counter += 1;
    return `job-${this.counter}`;
  }

  private track(
    base: Pick<JobRecord, 'id' | 'command' | 'nodeId' | 'log' | 'adopted'>,
    timeoutMs: number | undefined,
    child: ChildProcess | undefined,
    pgid: number | undefined,
  ): Tracked {
    const limit = Math.min(timeoutMs ?? this.options.timeoutMs, this.options.timeoutMs);
    const now = Date.now();
    let resolveEnded: () => void = () => undefined;
    const tracked: Tracked = {
      record: {
        id: base.id,
        command: base.command,
        nodeId: base.nodeId,
        startedAt: new Date(now).toISOString(),
        deadline: new Date(now + limit).toISOString(),
        status: 'running',
        ...(base.log ? { log: base.log } : {}),
        ...(base.adopted ? { adopted: true } : {}),
      },
      ...(child ? { child } : {}),
      ...(pgid !== undefined ? { pgid } : {}),
      ended: new Promise<void>((resolve) => {
        resolveEnded = resolve;
      }),
      finish: (status, reason) => {
        if (tracked.record.status !== 'running') {
          return;
        }
        clearTimeout(tracked.timer);
        clearInterval(tracked.poll);
        tracked.record.status = status;
        tracked.record.endedAt = new Date().toISOString();
        if (reason) {
          tracked.record.reason = reason;
        }
        resolveEnded();
        this.options.onEvent?.({ type: 'job_ended', job: { ...tracked.record } });
      },
    };
    tracked.timer = setTimeout(() => {
      killGroup(tracked);
      tracked.finish('timed out', `still running at its ${duration(limit)} deadline`);
    }, Math.min(limit, MAX_TIMER_MS));
    // A job must never keep the process alive on its own; the run stops it at the end anyway.
    tracked.timer.unref?.();
    this.jobs.set(base.id, tracked);
    this.options.onEvent?.({ type: 'job_started', job: { ...tracked.record } });
    return tracked;
  }

  /** Ends the job once no process is left in its group (or, without groups, once its shell exited). */
  private watchGroup(tracked: Tracked): void {
    if (tracked.record.status !== 'running') {
      return;
    }
    if (tracked.pgid === undefined || !OWN_PROCESS_GROUP || !groupAlive(tracked.pgid)) {
      tracked.finish('exited');
      return;
    }
    tracked.poll ??= setInterval(() => {
      if (tracked.pgid === undefined || !groupAlive(tracked.pgid)) {
        tracked.finish('exited');
      }
    }, GROUP_POLL_MS);
    tracked.poll.unref?.();
  }
}

/** Whether any process is left in the group: signal 0 only checks. */
export function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function killGroup(tracked: Tracked): void {
  if (tracked.pgid !== undefined && OWN_PROCESS_GROUP) {
    try {
      process.kill(-tracked.pgid, 'SIGKILL');
      return;
    } catch {
      // The group is gone; fall through to the shell itself.
    }
  }
  tracked.child?.kill('SIGKILL');
}

/** `4m12s`, `35s`. */
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m${seconds % 60}s`;
}

/** One line about a job, for the model: what it is, how it stands, where its output is. */
export function describeJob(job: JobRecord, labelOf: (nodeId: string) => string, now = Date.now()): string {
  const started = Date.parse(job.startedAt);
  const command = job.command.length > 120 ? `${job.command.slice(0, 117)}...` : job.command;
  const parts = [`${job.id} (${command})`];
  if (job.status === 'running') {
    parts.push(`running ${duration(now - started)}`, `killed in ${duration(Date.parse(job.deadline) - now)} if still running`);
  } else {
    const took = duration(Date.parse(job.endedAt ?? job.startedAt) - started);
    const how =
      job.status === 'exited'
        ? `exited${job.exitCode !== undefined && job.exitCode !== null ? ` with code ${job.exitCode}` : ''} after ${took}`
        : `${job.status} after ${took}${job.reason ? ` (${job.reason})` : ''}`;
    parts.push(how);
  }
  parts.push(`started by "${labelOf(job.nodeId)}"`);
  parts.push(job.log ? `log ${job.log}` : 'output not captured: it went wherever the command sent it');
  return parts.join(' · ');
}

/**
 * The jobs one node can see and control: those it received from the nodes
 * before it, and those it starts or takes on itself.
 */
export class NodeJobs {
  private readonly held: string[];

  constructor(
    readonly registry: JobRegistry,
    readonly nodeId: string,
    received: string[],
    private readonly labelOf: (nodeId: string) => string,
  ) {
    this.held = [...new Set(received)];
  }

  ids(): string[] {
    return [...this.held];
  }

  jobs(): JobRecord[] {
    return this.held.map((id) => this.registry.get(id)).filter((job): job is JobRecord => job !== undefined);
  }

  running(): JobRecord[] {
    return this.jobs().filter((job) => job.status === 'running');
  }

  holds(id: string): boolean {
    return this.held.includes(id);
  }

  async start(command: string, timeoutMs?: number): Promise<JobRecord> {
    const job = await this.registry.start(command, this.nodeId, timeoutMs);
    this.held.push(job.id);
    return job;
  }

  adopt(pgid: number, command: string): JobRecord {
    const job = this.registry.adopt(pgid, command, this.nodeId);
    this.held.push(job.id);
    return job;
  }

  describe(job: JobRecord): string {
    return describeJob(job, this.labelOf);
  }

  stoppedBy(): string {
    return `stopped by "${this.labelOf(this.nodeId)}"`;
  }

  /** The jobs part of the step note, or undefined when the node holds none. */
  statusLine(): string | undefined {
    const jobs = this.jobs();
    if (jobs.length === 0) {
      return undefined;
    }
    const now = Date.now();
    const shown = jobs.map((job) =>
      job.status === 'running'
        ? `${job.id} running ${duration(now - Date.parse(job.startedAt))}`
        : `${job.id} ${job.status}${job.exitCode !== undefined && job.exitCode !== null ? ` ${job.exitCode}` : ''}`,
    );
    return `jobs: ${shown.join(', ')}`;
  }
}
