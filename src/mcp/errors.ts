import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { FlowError } from '../app/flow-service';
import { PreflightError } from '../app/preflight';
import { UsageError } from '../app/usage-error';
import { FlowFormatError } from '../runtime/flow-payload';
import type { McpContext } from './context';
import { PolicyError } from './policy';

/** Domain failures become concise tool errors; unexpected ones are logged and hidden. */
export async function withToolErrors(
  operation: () => Promise<CallToolResult>,
  context: McpContext,
): Promise<CallToolResult> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof FlowError || error instanceof FlowFormatError || error instanceof UsageError) {
      return context.results.error(error.message);
    }
    if (error instanceof PreflightError || error instanceof PolicyError) {
      return context.results.error(error.message);
    }
    context.logger.error('Unhandled MCP tool error', error);
    return context.results.error('The operation failed. See the server log for details.');
  }
}
