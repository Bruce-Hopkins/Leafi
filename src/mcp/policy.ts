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

/** Rejects a flow before any provider, mailbox or browser work begins. */
export function assertFlowAllowed(graph: Graph, policy: McpPolicy): void {
  const blocked: string[] = [];
  for (const node of graph.nodes) {
    if (node.permissions.bash && !policy.allowBash) {
      blocked.push(`"${node.label}" requests bash`);
    }
    if (node.permissions.write && !policy.allowWrite) {
      blocked.push(`"${node.label}" requests write`);
    }
    if (node.permissions.web && !policy.allowWeb) {
      blocked.push(`"${node.label}" requests web`);
    }
    if (node.permissions.email_read && !policy.allowEmail) {
      blocked.push(`"${node.label}" requests email_read`);
    }
    if (node.permissions.browser && !policy.allowBrowser) {
      blocked.push(`"${node.label}" requests browser`);
    }
  }

  if (blocked.length > 0) {
    throw new PolicyError(
      `The MCP server policy denies this flow: ${blocked.join(', ')}. The person can allow it by running \`node "${path.resolve(process.argv[1] ?? 'server.mjs')}" settings\`, then restarting the server.`,
    );
  }
}
