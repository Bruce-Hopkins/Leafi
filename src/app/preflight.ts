import type { RuntimeConfig } from '../config/runtime-config';
import { validateGraph } from '../domain/graph-validation';
import type { Graph } from '../domain/types';
import { emailPreflight } from '../email/email-preflight';
import type { EmailService } from '../email/email-service';
import { mcpPreflight } from '../tools/mcp/mcp-preflight';

/** A run blocked before its first model call. `exitCode` matches the CLI contract. */
export class PreflightError extends Error {
  constructor(
    message: string,
    readonly exitCode: 2 | 4,
  ) {
    super(message);
    this.name = 'PreflightError';
  }
}

/** Free checks that must pass before a run is allowed to spend tokens. */
export async function preflightGraph(graph: Graph, config: RuntimeConfig, email: EmailService): Promise<void> {
  const issues = validateGraph(graph);
  if (issues.length > 0) {
    throw new PreflightError(
      issues.map((issue) => issue.message).join(' '),
      2,
    );
  }

  const missing = graph.nodes.filter((node) => !config.apiKeyFor(node.provider));
  if (missing.length > 0) {
    const labels = missing.map((node) => `${node.label} (${node.provider})`).join(', ');
    throw new PreflightError(`No API key is configured for: ${labels}.`, 4);
  }

  const mailbox = await emailPreflight(graph, email);
  if (mailbox.errors.length > 0) {
    throw new PreflightError(mailbox.errors.join(' '), 4);
  }

  const mcp = await mcpPreflight(graph.nodes, {
    command: config.mcpCommand,
    dataDir: config.dataDir,
    timeoutMs: config.mcpTimeoutMs,
    allowlist: config.mcpTools,
  });
  if (mcp.length > 0) {
    throw new PreflightError(mcp.join(' '), 4);
  }
}
