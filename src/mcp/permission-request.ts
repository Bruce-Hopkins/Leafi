import type { ElicitRequestFormParams, ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import type { Graph } from '../domain/types';
import type { McpLogger } from './logger';
import { allowInPolicy, blockedPermissions, policyDenied, type AllowSetting, type BlockedPermission, type McpPolicy } from './policy';
import { changePermissions, PERMISSIONS } from './settings';

/** Shows the person a question through the MCP client. The agent cannot answer it. */
export type AskPerson = (params: ElicitRequestFormParams) => Promise<ElicitResult>;

export interface PermissionContext {
  policy: McpPolicy;
  /** The settings file this server read, where "always" is saved; none when it read no file. */
  settingsFile?: string;
  logger: McpLogger;
}

/**
 * Before a flow starts, asks the person to allow each permission it requests
 * that the policy denies, naming the nodes that want it. The question goes to
 * the person through the client, never to the agent, so text a flow reads
 * cannot grant itself a permission.
 *
 * Accepting allows them for this run. Ticking "always" also saves them to the
 * settings file and allows them for the rest of this server's life. A client
 * that cannot ask, a refusal, or a failed question gets the policy error,
 * which names the command that allows them. Returns what was granted.
 */
export async function requestPermissions(
  graph: Graph,
  context: PermissionContext,
  ask: AskPerson | undefined,
): Promise<ReadonlySet<AllowSetting>> {
  const blocked = blockedPermissions(graph, context.policy);
  if (blocked.length === 0) {
    return new Set();
  }
  if (!ask) {
    throw policyDenied(blocked);
  }

  const canSave = context.settingsFile !== undefined;
  let answer: ElicitResult;
  try {
    answer = await ask({
      mode: 'form',
      message: question(blocked, canSave),
      requestedSchema: {
        type: 'object',
        properties: canSave
          ? {
              always: {
                type: 'boolean',
                title: 'Always allow',
                description: `Save this to ${context.settingsFile}, so later flows can use it without asking.`,
                default: false,
              },
            }
          : {},
      },
    });
  } catch (error) {
    context.logger.error('Asking the person for permission failed', error);
    throw policyDenied(blocked, 'The person could not be asked to allow this flow');
  }

  if (answer.action !== 'accept') {
    throw policyDenied(blocked, 'The person did not allow this flow');
  }

  const granted = new Set(blocked.map((entry) => entry.setting));
  const always = answer.content?.always;
  if (canSave && (always === true || always === 'true')) {
    await save(context, granted);
  }
  return granted;
}

function question(blocked: readonly BlockedPermission[], canSave: boolean): string {
  const lines = ['This flow needs permissions that are turned off:'];
  for (const entry of blocked) {
    const about = PERMISSIONS.find((permission) => permission.name === entry.setting)?.about ?? entry.id;
    lines.push(`- ${entry.id}: ${about}. Nodes: ${entry.nodes.map((label) => `"${label}"`).join(', ')}.`);
  }
  lines.push('', 'Allow them for this run?');
  if (!canSave) {
    lines.push(
      `To stop being asked, run: node "${process.argv[1] ?? 'server.mjs'}" settings --allow ${blocked.map((entry) => entry.id).join(',')}`,
    );
  }
  return lines.join('\n');
}

async function save(context: PermissionContext, granted: ReadonlySet<AllowSetting>): Promise<void> {
  const file = context.settingsFile;
  if (file === undefined) {
    return;
  }
  try {
    await changePermissions([{ envFile: file, hermes: false }], async (reads) =>
      reads.map((read) => {
        const wanted = new Map(read);
        granted.forEach((setting) => wanted.set(setting, true));
        return wanted;
      }),
    );
    allowInPolicy(context.policy, granted);
  } catch (error) {
    // The run is still allowed: the person said yes. Only the remembering failed.
    context.logger.error(`Could not save the permissions to ${file}`, error);
  }
}
