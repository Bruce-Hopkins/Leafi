import fs from 'node:fs';
import path from 'node:path';
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Type } from 'typebox';
import { Bridge } from './bridge';
import { registerCommands } from './commands';
import { askPerson } from './elicitation';
import { RunWatcher, type WatchUi } from './run-watch';
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

/** Registers everything and returns the bridge, so a test can inspect or stop it. Starts nothing. */
export function registerLeafi(pi: ExtensionAPI, options: LeafiOptions): Bridge<ExtensionContext> {
  const env = options.env ?? process.env;
  const watcher = new RunWatcher((message, sendOptions) => pi.sendMessage(message, sendOptions));
  const bridge = new Bridge<ExtensionContext>({
    serverPath: options.serverPath,
    env,
    version: options.manifest.version,
    elicit: (params, context) => askPerson(params, context),
    onRunNotification: (params) => watcher.handle(params),
  });

  for (const tool of options.manifest.tools) {
    // The extension's own leafi_wait_run (below) wraps it, adding progress in Pi's UI.
    if (tool.name === 'wait_run') {
      continue;
    }
    const { $schema: _ignored, ...schema } = tool.inputSchema;
    pi.registerTool({
      name: `${TOOL_PREFIX}${tool.name}`,
      label: `leafi ${tool.name.replace(/_/g, ' ')}`,
      description: tool.description,
      parameters: Type.Unsafe<Record<string, unknown>>(schema),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const result = await bridge.callTool(tool.name, params, { signal, context: ctx });
        return tool.name === 'start_run' ? startedRun(result, ctx, watcher) : toPiResult(result);
      },
    });
  }

  pi.registerTool({
    name: `${TOOL_PREFIX}wait_run`,
    label: 'leafi wait run',
    description:
      'Wait for a leafi run to finish without spending model calls, then return the run exactly as leafi_get_run does. ' +
      'Call it right after leafi_start_run when its result says "delivery": "wait"; never poll leafi_get_run. ' +
      'The call returns the moment the run ends. If the wait times out it says the run is still going; call it again. ' +
      'Pressing Esc stops the wait, not the run.',
    parameters: Type.Object({
      runId: Type.String({ minLength: 1 }),
      maxWaitSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 1800, description: `Give up waiting after this long (default ${DEFAULT_WAIT_SECONDS}).` })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const lines: string[] = [];
      const outcome = await watcher.waitingOn(params.runId, () =>
        waitForRun(
          {
            call: (name, args, extra) =>
              bridge.callTool(name, args, {
                signal,
                context: ctx,
                timeoutMs: extra.timeoutMs,
                onProgress: (progress) => extra.onProgress(progress.message ?? ''),
              }),
          },
          {
            runId: params.runId,
            maxWaitMs: (params.maxWaitSeconds ?? DEFAULT_WAIT_SECONDS) * 1000,
            signal,
            onProgress: (line) => {
              lines.push(line);
              onUpdate?.({ content: [{ type: 'text', text: lines.slice(-8).join('\n') }], details: {} });
            },
          },
        ),
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
    watcher.clear();
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

/**
 * With a UI, the watcher draws the run and tells the model when it ends, so
 * the model can end its turn. Without one (`pi -p`) nothing would be drawn
 * and the process may exit when the turn ends, so the model waits instead.
 */
function startedRun(result: CallToolResult, ctx: ExtensionContext | undefined, watcher: RunWatcher): ReturnType<typeof toPiResult> {
  const piResult = toPiResult(result);
  let run: { id?: string; delivery?: string };
  try {
    run = JSON.parse(piResult.content[0]?.text ?? '');
  } catch {
    return piResult;
  }
  if (run.delivery !== 'plugin' || typeof run.id !== 'string') {
    return piResult;
  }
  if (ctx?.hasUI) {
    watcher.watch(run.id, ctx.ui as WatchUi);
    return piResult;
  }
  return { content: [{ type: 'text', text: JSON.stringify({ ...run, delivery: 'wait' }, null, 2) }], details: {} };
}
