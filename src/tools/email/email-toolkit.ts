import type { StructuredToolInterface } from '@langchain/core/tools';
import { permittedEmailTools } from '../../email/email-catalog';
import type { MailboxConnection } from '../../email/email-client';
import { describeError } from '../../email/email-errors';
import type { NodePermissions } from '../../domain/types';
import type { ToolOutput } from '../tool-output';
import { EMAIL_TOOL_HANDLERS } from './imap-tools';
import type { EmailCallContext, EmailToolHandler } from './email-handlers';

const HANDLERS: Record<string, EmailToolHandler> = { ...EMAIL_TOOL_HANDLERS };

export interface EmailToolkitOptions {
  permissions: NodePermissions;
  /** The run's mailbox connection. The toolkit owns closing it. */
  connection: MailboxConnection;
  /** The node's output budget; a long message is saved for it to read on from. */
  output: ToolOutput;
}

export interface EmailToolkit {
  schemas: StructuredToolInterface[];
  /** Runs a mail tool, or returns undefined when `name` is not one of ours. */
  execute(name: string, args: Record<string, unknown>): Promise<string | undefined>;
  /** Closes the mailbox socket. Safe when no tool was ever called. */
  dispose(): Promise<void>;
}

/**
 * Builds the mailbox half of a node's tools. The permission set decides what
 * exists at all; a tool the node lacks is never shown to the model and cannot be
 * invoked by name either.
 */
export function createEmailToolkit(options: EmailToolkitOptions): EmailToolkit {
  const permitted = permittedEmailTools(options.permissions);
  const context: EmailCallContext = {
    read: (operation) => options.connection.run(operation),
    output: options.output,
  };

  const schemas = permitted.flatMap((tool) => {
    const handler = HANDLERS[tool.name];
    return handler ? [handler.schema(options.output)] : [];
  });

  return {
    schemas,
    async execute(name, args) {
      if (!permitted.some((tool) => tool.name === name)) {
        return undefined;
      }

      const handler = HANDLERS[name];
      if (!handler) {
        return undefined;
      }

      try {
        return await handler.run(context, args);
      } catch (error) {
        return `Error: ${describeError(error)}`;
      }
    },
    dispose: () => options.connection.dispose(),
  };
}
