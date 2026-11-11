import fs from 'node:fs';
import path from 'node:path';
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Type } from 'typebox';
import { Bridge } from './bridge';
import { registerCommands } from './commands';
import { askPerson } from './elicitation';
import { textOf, waitForRun } from './wait-run';

/** Set by the extension bundle to the folder holding it; unset when run from source. */
declare const __PI_DIR__: string | undefined;

export const TOOL_PREFIX = 'leafi_';

/** What `scripts/build-pi-extension.mjs` writes to `dist/tools.json`. */
export interface Manifest {
  version: string;
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
}

export interface LeafiOptions {
  manifest: Manifest;
  serverPath: string;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_WAIT_SECONDS = 600;
const POLL_MS = 3000;

/** Registers everything and returns the bridge, so a test can inspect or stop it. Starts nothing. */
export function registerLeafi(pi: ExtensionAPI, options: LeafiOptions): Bridge<ExtensionContext> {
  const env = options.env ?? process.env;
  const bridge = new Bridge<ExtensionContext>({
    serverPath: options.serverPath,
    env,
    version: options.manifest.version,
    elicit: (params, context) => askPerson(params, context),
  });

  for (const tool of options.manifest.tools) {
    const { $schema: _ignored, ...schema } = tool.inputSchema;
    pi.registerTool({
      name: `${TOOL_PREFIX}${tool.name}`,
      label: `leafi ${tool.name.replace(/_/g, ' ')}`,
      description: tool.description,
      parameters: Type.Unsafe<Record<string, unknown>>(schema),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const result = await bridge.callTool(tool.name, params, { signal, context: ctx });
        return toPiResult(result);
      },
    });
  }

  pi.registerTool({
    name: `${TOOL_PREFIX}wait_run`,
    label: 'leafi wait run',
    description:
      'Wait for a leafi run to finish without spending model calls, then return the run exactly as leafi_get_run does. ' +
      'Call it right after leafi_start_run instead of polling leafi_get_run. If the wait times out it says the run is still going; call it again. ' +
      'Pressing Esc stops the wait, not the run.',
    parameters: Type.Object({
      runId: Type.String({ minLength: 1 }),
      maxWaitSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 1800, description: `Give up waiting after this long (default ${DEFAULT_WAIT_SECONDS}).` })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const lines: string[] = [];
      const outcome = await waitForRun(
        {
          call: async (name, args) => bridge.callTool(name, args, { signal, context: ctx }),
          sleep: (ms) => sleep(ms, signal),
        },
        {
          runId: params.runId,
          maxWaitMs: (params.maxWaitSeconds ?? DEFAULT_WAIT_SECONDS) * 1000,
          pollMs: POLL_MS,
          signal,
          onProgress: (line) => {
            lines.push(line);
            onUpdate?.({ content: [{ type: 'text', text: lines.slice(-8).join('\n') }], details: {} });
          },
        },
      );
      return { content: [{ type: 'text', text: outcome.text }], details: {} };
    },
  });

  registerCommands(pi, {
    bridge: bridge as unknown as Bridge<ExtensionCommandContext>,
    serverPath: options.serverPath,
    env,
  });

  // Idempotent: /new, /reload, /resume and quitting all end here.
  pi.on('session_shutdown', async () => {
    await bridge.close();
  });

  return bridge;
}

export default function (pi: ExtensionAPI): void {
  const dir = typeof __PI_DIR__ === 'string' ? __PI_DIR__ : path.resolve(__dirname, '..', '..', 'pi-extension', 'dist');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'tools.json'), 'utf8')) as Manifest;
  registerLeafi(pi, { manifest, serverPath: path.join(dir, 'server.mjs') });
}

function toPiResult(result: CallToolResult): { content: { type: 'text'; text: string }[]; details: Record<string, never> } {
  const text = textOf(result);
  if (result.isError) {
    throw new Error(text);
  }
  return { content: [{ type: 'text', text }], details: {} };
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Stopped waiting. The run is still going; cancel it with leafi_cancel_run.'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('Stopped waiting. The run is still going; cancel it with leafi_cancel_run.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
