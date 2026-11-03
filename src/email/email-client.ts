import { ImapFlow } from 'imapflow';
import type { EmailCredentials } from '../domain/types';
import { toEmailError } from './email-errors';

/** The one mailbox a node reads. Mailbox selection is out of scope. */
export const INBOX = 'INBOX';

/**
 * A mailbox connection shared by every tool call in one node run. Connecting is
 * the expensive part of IMAP and Gmail limits concurrent connections, so the
 * socket is opened once and reused; the mailbox lock is re-taken per call, which
 * is cheap. Timeouts are the library's own rather than a race around each call:
 * `socketTimeout` is an inactivity watchdog, so a stalled fetch fails instead of
 * hanging until the run's overall timeout.
 */
export class MailboxConnection {
  private client?: ImapFlow;

  constructor(
    private readonly credentials: EmailCredentials,
    private readonly timeoutMs: number,
  ) {}

  /** Runs `read` with `INBOX` selected, releasing the lock whatever happens. */
  async run<T>(read: (client: ImapFlow) => Promise<T>): Promise<T> {
    try {
      const client = await this.acquire();
      // EXAMINE rather than SELECT: the server itself refuses any change to the mailbox.
      const lock = await client.getMailboxLock(INBOX, { readOnly: true });
      try {
        return await read(client);
      } finally {
        lock.release();
      }
    } catch (error) {
      throw toEmailError(error, this.credentials);
    }
  }

  /** Closes the socket. Safe to call when nothing was ever opened. */
  async dispose(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (!client) {
      return;
    }
    await client.logout().catch(() => client.close());
  }

  private async acquire(): Promise<ImapFlow> {
    if (this.client?.usable) {
      return this.client;
    }

    const client = new ImapFlow(clientOptions(this.credentials, this.timeoutMs));
    // A socket closing between calls is reported by the operation that needs it.
    // Without a listener an 'error' event during teardown would take the process down.
    client.on('error', () => undefined);
    await client.connect();
    this.client = client;
    return client;
  }
}

/**
 * One login and nothing else, for checking the credentials before a run spends
 * tokens. `verifyOnly` makes ImapFlow log itself out after a successful
 * authentication, so there is no mailbox to select and nothing to clean up.
 */
export async function verifyMailbox(credentials: EmailCredentials, timeoutMs: number): Promise<void> {
  const client = new ImapFlow({ ...clientOptions(credentials, timeoutMs), verifyOnly: true });
  client.on('error', () => undefined);
  try {
    await client.connect();
  } catch (error) {
    throw toEmailError(error, credentials);
  } finally {
    if (client.usable) {
      client.close();
    }
  }
}

function clientOptions(credentials: EmailCredentials, timeoutMs: number) {
  return {
    host: credentials.imapHost,
    port: credentials.imapPort,
    secure: true,
    auth: { user: credentials.address, pass: credentials.appPassword },
    logger: false as const,
    // Nothing watches for new mail, so an IDLE connection would be pure overhead.
    disableAutoIdle: true,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  };
}
