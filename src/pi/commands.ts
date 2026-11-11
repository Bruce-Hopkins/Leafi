import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Bridge, runServerCommand } from './bridge';
import { textOf } from './wait-run';

const SUBCOMMANDS = [
  { value: 'runs', label: 'runs', description: 'List recent runs' },
  { value: 'cancel', label: 'cancel <id>', description: 'Cancel a run that is still going' },
  { value: 'status', label: 'status', description: 'Is the server running, and which providers are set' },
  { value: 'settings', label: 'settings', description: 'Show the permissions flows have' },
];

export interface CommandDeps {
  bridge: Bridge<ExtensionCommandContext>;
  serverPath: string;
  env: NodeJS.ProcessEnv;
}

interface RunSummary {
  id: string;
  graphName: string;
  status: string;
  startedAt: string;
  costUsd?: number;
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
  pi.registerCommand('leafi', {
    description: 'leafi flows: runs | cancel <id> | status | settings',
    getArgumentCompletions: (prefix) => {
      const matches = SUBCOMMANDS.filter((entry) => entry.value.startsWith(prefix.trim()));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      const [subcommand = 'status', ...rest] = args.trim().split(/\s+/).filter(Boolean);
      try {
        ctx.ui.notify(await run(subcommand, rest, ctx, deps), 'info');
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
      }
    },
  });
}

async function run(subcommand: string, rest: string[], ctx: ExtensionCommandContext, deps: CommandDeps): Promise<string> {
  switch (subcommand) {
    case 'runs':
      return runs(ctx, deps, rest[0]);
    case 'cancel':
      return cancel(ctx, deps, rest[0]);
    case 'status':
      return status(ctx, deps);
    case 'settings':
      return settings(deps);
    default:
      return `Unknown subcommand "${subcommand}". Use: runs | cancel <id> | status | settings`;
  }
}

async function runs(ctx: ExtensionCommandContext, deps: CommandDeps, limit: string | undefined): Promise<string> {
  const amount = Math.min(100, Math.max(1, Number.parseInt(limit ?? '10', 10) || 10));
  const list = JSON.parse(unwrap(await deps.bridge.callTool('list_runs', { limit: amount }, { context: ctx }))) as RunSummary[];
  if (list.length === 0) {
    return 'No runs yet.';
  }
  return list
    .map((run) => `${run.id}  ${run.status.padEnd(9)} ${run.graphName}  ${run.startedAt}${run.costUsd !== undefined ? `  $${run.costUsd.toFixed(4)}` : ''}`)
    .join('\n');
}

async function cancel(ctx: ExtensionCommandContext, deps: CommandDeps, runId: string | undefined): Promise<string> {
  if (!runId) {
    return 'Usage: /leafi cancel <run id>';
  }
  const answer = JSON.parse(unwrap(await deps.bridge.callTool('cancel_run', { runId }, { context: ctx }))) as { cancelled: boolean };
  return answer.cancelled ? `Cancelled ${runId}.` : `${runId} is not running in this session, so there was nothing to cancel.`;
}

async function status(ctx: ExtensionCommandContext, deps: CommandDeps): Promise<string> {
  const dataDir = deps.env.LEAFI_HOME ?? deps.env.DATA_DIR ?? '~/.leafi';
  if (!deps.bridge.running) {
    return `Server: not started (it starts on the first leafi tool call)\nData directory: ${dataDir}`;
  }
  const providers = JSON.parse(unwrap(await deps.bridge.callTool('list_providers', {}, { context: ctx }))) as unknown;
  const names = Array.isArray(providers)
    ? providers.map((entry) => (typeof entry === 'object' && entry !== null && 'id' in entry ? String((entry as { id: unknown }).id) : String(entry)))
    : Object.keys(providers as object);
  return `Server: running\nData directory: ${dataDir}\nProviders with keys: ${names.length > 0 ? names.join(', ') : 'none, run "node ' + deps.serverPath + ' init" in a terminal'}`;
}

function settings(deps: CommandDeps): string {
  const result = runServerCommand(deps.serverPath, ['settings', '--json'], deps.env);
  if (!result.ok) {
    return `Could not read the settings: ${result.stderr.trim() || 'the server exited with an error'}`;
  }
  const parsed = JSON.parse(result.stdout) as { files: { envFile: string; permissions: Record<string, boolean> }[] };
  const lines: string[] = [];
  for (const file of parsed.files) {
    lines.push(`Permissions in ${file.envFile}:`);
    for (const [id, allowed] of Object.entries(file.permissions)) {
      lines.push(`  ${id.padEnd(11)} ${allowed ? 'allowed' : 'denied'}`);
    }
  }
  lines.push('', 'Change them in a terminal, then run /new in Pi so the server restarts:', `  node "${deps.serverPath}" settings --allow bash,mcp`);
  return lines.join('\n');
}

function unwrap(result: CallToolResult): string {
  const text = textOf(result);
  if (result.isError) {
    throw new Error(text);
  }
  return text;
}
