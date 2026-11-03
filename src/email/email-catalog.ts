import type { NodePermissions } from '../domain/types';

export interface EmailToolDefinition {
  name: string;
  /** The node permission that grants this tool. */
  permission: keyof NodePermissions;
}

/**
 * The single source of truth linking a mail tool to the permission that grants
 * it, so schema assembly and authorization cannot drift apart. There is no send
 * tool, so there is no "kind" and nothing for a server-side write switch to gate.
 */
export const EMAIL_TOOLS: readonly EmailToolDefinition[] = [
  { name: 'email_search', permission: 'email_read' },
  { name: 'email_get_message', permission: 'email_read' },
];

/** The tools a node may be offered. A tool the node lacks is never shown to the model. */
export function permittedEmailTools(permissions: Partial<NodePermissions>): EmailToolDefinition[] {
  return EMAIL_TOOLS.filter((tool) => permissions[tool.permission] === true);
}

export function findEmailTool(name: string): EmailToolDefinition | undefined {
  return EMAIL_TOOLS.find((tool) => tool.name === name);
}
