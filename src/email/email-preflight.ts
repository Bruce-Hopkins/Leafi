import { usesEmail } from '../domain/permissions';
import type { Graph } from '../domain/types';
import { describeError } from './email-errors';
import type { EmailService } from './email-service';

export interface EmailPreflight {
  /** Reasons a run cannot proceed, phrased for the person who must fix them. */
  errors: string[];
}

/**
 * Whether the mailbox can serve this graph: a credential exists *and* the
 * mailbox accepted it. The login here is shared with the executor's own readiness
 * check through `EmailService`'s memoized result, so a run logs in once either
 * way — but catching a rejected password here means it is a pre-flight failure
 * (exit 4) rather than a node failure part-way into the run.
 */
export async function emailPreflight(graph: Graph, email: EmailService): Promise<EmailPreflight> {
  const needing = graph.nodes.filter((node) => usesEmail(node.permissions));
  if (needing.length === 0) {
    return { errors: [] };
  }

  try {
    await email.assertReady();
    return { errors: [] };
  } catch (error) {
    const labels = needing.map((node) => `"${node.label}"`).join(', ');
    return { errors: [`${labels} ${needing.length === 1 ? 'needs' : 'need'} mailbox access. ${describeError(error)}`] };
  }
}
