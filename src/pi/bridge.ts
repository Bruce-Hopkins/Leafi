import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema, type CallToolResult, type ElicitRequestFormParams, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';

/** What the child process may see of Pi's environment. Provider keys and LEAFI_* are what flows need. */
const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SYSTEMROOT',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'OPENROUTER_API_KEY',
] as const;

const START_RUN_TIMEOUT_MS = 6 * 60 * 1000; // the server waits up to 5 minutes for the person
const CALL_TIMEOUT_MS = 60 * 1000;
const STDERR_TAIL_LINES = 20;

/** Answers the server's question to the person. `context` belongs to the tool call that caused it. */
export type Elicitor<Context> = (params: ElicitRequestFormParams, context: Context | undefined) => Promise<ElicitResult>;

export interface BridgeOptions<Context> {
  /** Absolute path to the bundled `server.mjs`. */
  serverPath: string;
  elicit: Elicitor<Context>;
  /** The environment to filter; Pi's own by default. */
  env?: NodeJS.ProcessEnv;
  version?: string;
}

interface Connection {
  client: Client;
  transport: StdioClientTransport;
  pid: number | undefined;
}

interface InFlight<Context> {
  tool: string;
  context: Context;
}

/**
 * Starts the leafi MCP server as a child process on first use and talks to it
 * over stdio. The server never runs inside Pi: it loads `~/.leafi/.env` into
 * its own environment, which would otherwise leak into Pi's.
 */
export class Bridge<Context> {
  private connection: Promise<Connection> | undefined;
  private readonly inFlight = new Set<InFlight<Context>>();
  private readonly stderrTail: string[] = [];
  private exitHook: (() => void) | undefined;

  constructor(private readonly options: BridgeOptions<Context>) {}

  /** Whether the server has been started and not closed. */
  get running(): boolean {
    return this.connection !== undefined;
  }

  /** The last lines the server wrote to stderr, for error messages. */
  get recentStderr(): string {
    return this.stderrTail.join('\n');
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal | undefined; context: Context },
  ): Promise<CallToolResult> {
    const { client } = await this.ensure();
    const entry: InFlight<Context> = { tool: name, context: options.context };
    this.inFlight.add(entry);
    try {
      const result = await client.callTool({ name, arguments: args }, undefined, {
        signal: options.signal,
        timeout: name === 'start_run' ? START_RUN_TIMEOUT_MS : CALL_TIMEOUT_MS,
      });
      return result as CallToolResult;
    } finally {
      this.inFlight.delete(entry);
    }
  }

  /**
   * Stops the server. SIGTERM first: its handler cancels active runs and
   * stores them as cancelled. Safe to call twice, and when it never started.
   */
  async close(): Promise<void> {
    const pending = this.connection;
    this.connection = undefined;
    if (!pending) {
      return;
    }
    let connection: Connection;
    try {
      connection = await pending;
    } catch {
      return;
    }
    if (this.exitHook) {
      process.off('exit', this.exitHook);
      this.exitHook = undefined;
    }
    const { pid } = connection;
    if (pid !== undefined) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
    await connection.client.close().catch(() => undefined);
    if (pid !== undefined) {
      await waitForExit(pid, 3000);
    }
  }

  private ensure(): Promise<Connection> {
    if (!this.connection) {
      const starting = this.start();
      this.connection = starting;
      starting.catch(() => {
        if (this.connection === starting) {
          this.connection = undefined;
        }
      });
    }
    return this.connection;
  }

  private async start(): Promise<Connection> {
    const transport = new StdioClientTransport({
      command: nodeCommand(),
      args: [this.options.serverPath, '--transport', 'stdio'],
      env: allowedEnvironment(this.options.env ?? process.env),
      // The default is to inherit, which would draw the server's logs inside Pi's TUI.
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim() !== '') {
          this.stderrTail.push(line);
        }
      }
      this.stderrTail.splice(0, Math.max(0, this.stderrTail.length - STDERR_TAIL_LINES));
    });

    const client = new Client(
      { name: 'pi-leafi', version: this.options.version ?? '0.0.0' },
      { capabilities: { elicitation: { form: {} } } },
    );
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      if (request.params.mode === 'url') {
        return { action: 'decline' };
      }
      // Only start_run asks; answer with the context of that call.
      const asking = [...this.inFlight].reverse().find((entry) => entry.tool === 'start_run');
      return this.options.elicit(request.params as ElicitRequestFormParams, asking?.context);
    });

    try {
      await client.connect(transport);
    } catch (error) {
      await transport.close().catch(() => undefined);
      const detail = this.recentStderr ? `\n${this.recentStderr}` : '';
      throw new Error(`Could not start the leafi server (${this.options.serverPath}): ${error instanceof Error ? error.message : String(error)}${detail}`);
    }

    const connection: Connection = { client, transport, pid: transport.pid ?? undefined };
    // A hard exit of Pi skips session_shutdown; do not leave the server behind.
    this.exitHook = () => {
      if (connection.pid !== undefined) {
        try {
          process.kill(connection.pid, 'SIGTERM');
        } catch {
          // already gone
        }
      }
    };
    process.once('exit', this.exitHook);
    return connection;
  }
}

/** `process.execPath` is Pi itself when Pi is a compiled binary; only a real Node is reused. */
export function nodeCommand(execPath: string = process.execPath): string {
  const file = execPath.split(/[\\/]/).pop() ?? '';
  return /^node(\.exe)?$/i.test(file) ? execPath : 'node';
}

export function allowedEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    if ((ENV_ALLOWLIST as readonly string[]).includes(key) || key.startsWith('LEAFI_') || key.startsWith('LC_')) {
      env[key] = value;
    }
  }
  return env;
}

async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Runs the installed `server.mjs` for one-shot commands such as `settings`. */
export function runServerCommand(serverPath: string, args: string[], env: NodeJS.ProcessEnv): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(nodeCommand(), [serverPath, ...args], { env: allowedEnvironment(env), encoding: 'utf8', timeout: 15_000 });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
