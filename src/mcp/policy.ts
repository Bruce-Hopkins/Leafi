import path from 'node:path';
import { readBoolean, type RuntimeConfig } from '../config/runtime-config';
import type { Graph } from '../domain/types';

/** What the MCP server is allowed to run, independent of what a flow requests. */
export interface McpPolicy {
  allowBash: boolean;
  allowWrite: boolean;
  allowWeb: boolean;
  allowEmail: boolean;
  allowBrowser: boolean;
  allowFlowPaths: boolean;
  maxConcurrentRuns: number;
  maxFlowBytes: number;
  maxResultBytes: number;
}

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

/** What the server reads when a AGENTS_AUTOMATIONS_ALLOW_* setting is unset or empty. */
export const ALLOW_DEFAULTS = {
  AGENTS_AUTOMATIONS_ALLOW_BASH: false,
  AGENTS_AUTOMATIONS_ALLOW_WRITE: false,
  AGENTS_AUTOMATIONS_ALLOW_WEB: false,
  AGENTS_AUTOMATIONS_ALLOW_EMAIL: false,
  AGENTS_AUTOMATIONS_ALLOW_BROWSER: false,
  AGENTS_AUTOMATIONS_ALLOW_FLOW_PATHS: true,
} as const;

export type AllowSetting = keyof typeof ALLOW_DEFAULTS;

export function readMcpPolicy(config: RuntimeConfig): McpPolicy {
  const allowed = (name: AllowSetting) => readBoolean(name, ALLOW_DEFAULTS[name]);
  return {
    allowBash: allowed('AGENTS_AUTOMATIONS_ALLOW_BASH'),
    allowWrite: allowed('AGENTS_AUTOMATIONS_ALLOW_WRITE'),
    allowWeb: allowed('AGENTS_AUTOMATIONS_ALLOW_WEB'),
    allowEmail: allowed('AGENTS_AUTOMATIONS_ALLOW_EMAIL'),
    allowBrowser: allowed('AGENTS_AUTOMATIONS_ALLOW_BROWSER'),
    allowFlowPaths: allowed('AGENTS_AUTOMATIONS_ALLOW_FLOW_PATHS'),
    maxConcurrentRuns: config.mcpMaxConcurrentRuns,
    maxFlowBytes: config.mcpMaxFlowBytes,
    maxResultBytes: config.mcpMaxResultBytes,
  };
}

/** A node permission the policy gates: its setting, the id `settings --allow` takes, and its policy field. */
interface GatedPermission {
  permission: 'bash' | 'write' | 'web' | 'email_read' | 'browser';
  setting: AllowSetting;
  id: string;
  field: 'allowBash' | 'allowWrite' | 'allowWeb' | 'allowEmail' | 'allowBrowser';
}

const GATED: readonly GatedPermission[] = [
  { permission: 'web', setting: 'AGENTS_AUTOMATIONS_ALLOW_WEB', id: 'web', field: 'allowWeb' },
  { permission: 'write', setting: 'AGENTS_AUTOMATIONS_ALLOW_WRITE', id: 'write', field: 'allowWrite' },
  { permission: 'bash', setting: 'AGENTS_AUTOMATIONS_ALLOW_BASH', id: 'bash', field: 'allowBash' },
  { permission: 'email_read', setting: 'AGENTS_AUTOMATIONS_ALLOW_EMAIL', id: 'email', field: 'allowEmail' },
  { permission: 'browser', setting: 'AGENTS_AUTOMATIONS_ALLOW_BROWSER', id: 'browser', field: 'allowBrowser' },
];

/** A permission a flow requests that the policy denies, with the labels of the nodes requesting it. */
export interface BlockedPermission extends GatedPermission {
  nodes: string[];
}

/** What the flow requests and the policy denies, less what the person granted for this run. */
export function blockedPermissions(
  graph: Graph,
  policy: McpPolicy,
  granted: ReadonlySet<AllowSetting> = new Set(),
): BlockedPermission[] {
  return GATED.filter((gate) => !policy[gate.field] && !granted.has(gate.setting))
    .map((gate) => ({ ...gate, nodes: graph.nodes.filter((node) => node.permissions[gate.permission]).map((node) => node.label) }))
    .filter((blocked) => blocked.nodes.length > 0);
}

/** Allows the settings in this server's policy until it stops, the way a saved setting would on its next start. */
export function allowInPolicy(policy: McpPolicy, settings: Iterable<AllowSetting>): void {
  for (const setting of settings) {
    const gate = GATED.find((entry) => entry.setting === setting);
    if (gate) {
      policy[gate.field] = true;
    }
  }
}

/** The refusal for a flow the policy denies, with the command that allows it. */
export function policyDenied(blocked: readonly BlockedPermission[], lead = 'The MCP server policy denies this flow'): PolicyError {
  const requests = blocked.flatMap((entry) => entry.nodes.map((label) => `"${label}" requests ${entry.permission}`));
  const server = path.resolve(process.argv[1] ?? 'server.mjs');
  return new PolicyError(
    `${lead}: ${requests.join(', ')}. The person can allow it by running ` +
      `\`node "${server}" settings --allow ${blocked.map((entry) => entry.id).join(',')}\`, then restarting the server.`,
  );
}

/** Rejects a flow before any provider, mailbox or browser work begins, unless the person granted what it needs. */
export function assertFlowAllowed(graph: Graph, policy: McpPolicy, granted?: ReadonlySet<AllowSetting>): void {
  const blocked = blockedPermissions(graph, policy, granted);
  if (blocked.length > 0) {
    throw policyDenied(blocked);
  }
}
