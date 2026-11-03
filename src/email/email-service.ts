import type { RuntimeConfig } from '../config/runtime-config';
import type { EmailStatus } from '../domain/types';
import { MailboxConnection, verifyMailbox } from './email-client';
import { EmailNotConfiguredError } from './email-errors';

/** How long the result of one login check is reused. */
const CHECK_TTL_MS = 60_000;

/**
 * Owns the mailbox credential and answers whether it works. There is no consent
 * flow and no token to refresh, so the service is thin: its one real job is
 * proving the app password is good before a run spends any tokens.
 */
export class EmailService {
  private check?: { at: number; inFlight: Promise<void> };

  constructor(private readonly config: RuntimeConfig) {}

  /** Naming the mailbox is harmless; the password is never part of this. */
  status(): EmailStatus {
    const credentials = this.config.emailCredentials();
    return credentials ? { configured: true, address: credentials.address } : { configured: false };
  }

  /** A connection for one node run, or undefined when no credential is configured. */
  open(): MailboxConnection | undefined {
    const credentials = this.config.emailCredentials();
    return credentials ? new MailboxConnection(credentials, this.config.emailTimeoutMs) : undefined;
  }

  /**
   * Proves the credentials work, before the first model call. An app password
   * has no "connected" state to inspect — it is either in the environment or not
   * — so the only honest check is a login. The result is shared by every node in
   * the run, so a flow with several mail-reading nodes still logs in once.
   */
  async assertReady(): Promise<void> {
    const credentials = this.config.emailCredentials();
    if (!credentials) {
      throw new EmailNotConfiguredError();
    }

    const now = Date.now();
    if (this.check && now - this.check.at < CHECK_TTL_MS) {
      return this.check.inFlight;
    }

    const inFlight = verifyMailbox(credentials, this.config.emailTimeoutMs);
    this.check = { at: now, inFlight };
    return inFlight;
  }
}
