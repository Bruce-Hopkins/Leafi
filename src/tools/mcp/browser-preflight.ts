import type { AgentNode } from '../../domain/types';
import { listBrowserTools } from './browser-toolkit';

export interface BrowserPreflightOptions {
  command: string;
  dataDir: string;
  timeoutMs: number;
  allowlist: readonly string[];
}

/**
 * Starts the browser MCP server once and checks the tools the flow expects are
 * there. A flow whose nodes hold the browser permission fails before its first
 * token when the launcher cannot bring a browser up.
 */
export async function browserPreflight(
  nodes: readonly AgentNode[],
  options: BrowserPreflightOptions,
): Promise<string[]> {
  const needing = nodes.filter((node) => node.permissions.browser);
  if (needing.length === 0) {
    return [];
  }

  const labels = needing.map((node) => `"${node.label}"`).join(', ');
  const repair = `Set AGENTS_AUTOMATIONS_BROWSER_MCP_COMMAND in the environment to a chrome-devtools-mcp launcher (current: ${options.command}).`;

  try {
    const tools = await listBrowserTools({
      command: options.command,
      dataDir: options.dataDir,
      timeoutMs: options.timeoutMs,
    });
    const offered = new Set(tools.map((tool) => tool.name));
    if (!options.allowlist.some((name) => offered.has(name))) {
      const available = tools.map((tool) => tool.name).join(', ');
      return [
        `${labels} need the browser, but the MCP server offers none of the tools they may use (${options.allowlist.join(', ')}). Set AGENTS_AUTOMATIONS_BROWSER_MCP_TOOLS to a subset of: ${available}.`,
      ];
    }
    return [];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [`${labels} need the browser, but the MCP server could not start. ${reason}\n${repair}`];
  }
}
