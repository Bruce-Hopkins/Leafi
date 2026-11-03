import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ImapFlow } from 'imapflow';
import type { ToolOutput } from '../tool-output';

/** What a mail tool needs: a connected mailbox and the node's output budget. */
export interface EmailCallContext {
  /** Runs `operation` against a connected mailbox with `INBOX` selected. */
  read<T>(operation: (client: ImapFlow) => Promise<T>): Promise<T>;
  output: ToolOutput;
}

export interface EmailToolHandler {
  /** The schema bound to the model, given the node's budget; the tool name must match the catalog entry. */
  schema(output: ToolOutput): StructuredToolInterface;
  run(context: EmailCallContext, args: Record<string, unknown>): Promise<string>;
}
