import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getMessage, MESSAGE_PREVIEW_BYTES, searchMessages } from '../../email/email-read';
import type { EmailCallContext, EmailToolHandler } from './email-handlers';

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 25;

export const EMAIL_TOOL_HANDLERS: Record<string, EmailToolHandler> = {
  email_search: {
    schema: () =>
      tool(async () => '', {
        name: 'email_search',
        description:
          'Search the connected mailbox and list matching messages with their sender, date and subject. ' +
          'With a Gmail mailbox the query is Gmail search syntax, e.g. "is:unread", "from:alice@example.com newer_than:7d". ' +
          'Use the returned uid with email_get_message to read one in full.',
        schema: z.object({
          query: z.string().describe('Search query, e.g. "is:unread newer_than:7d".'),
          maxResults: z
            .number()
            .optional()
            .describe(`How many messages to list, newest first (default ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT}).`),
        }),
      }),
    run: listMessages,
  },

  email_get_message: {
    schema: (output) =>
      tool(async () => '', {
        name: 'email_get_message',
        description:
          'Read one message by uid, including its headers and its text body. ' +
          'Reading a message never changes its read state. ' +
          `Long messages return their first ${MESSAGE_PREVIEW_BYTES} bytes, and ` +
          (output.saving ? 'the whole message is saved to a file you can read on from.' : 'the rest is not kept.'),
        schema: z.object({
          uid: z.number().describe('Message uid, as returned by email_search.'),
        }),
      }),
    run: readMessage,
  },
};

function listMessages(context: EmailCallContext, args: Record<string, unknown>): Promise<string> {
  return context.read((client) => searchMessages(client, args)).then((text) => context.output.cap('email_search', text));
}

function readMessage(context: EmailCallContext, args: Record<string, unknown>): Promise<string> {
  return context
    .read((client) => getMessage(client, args))
    .then((text) => context.output.cap('email_get_message', text, { previewBytes: MESSAGE_PREVIEW_BYTES }));
}
