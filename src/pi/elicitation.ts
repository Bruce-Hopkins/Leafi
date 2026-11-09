import type { ElicitRequestFormParams, ElicitResult } from '@modelcontextprotocol/sdk/types.js';

/** The part of Pi's context the permission question needs. */
export interface AskContext {
  hasUI: boolean;
  ui: { select(title: string, options: string[]): Promise<string | undefined> };
}

const ALLOW = 'Allow this run';
const ALWAYS = 'Always allow';
const DENY = 'Deny';

/**
 * Turns the server's permission question into a Pi selector. Without a UI
 * (print and JSON mode), when the dialog throws, or when the person escapes,
 * it declines, and the server fails closed with the message naming
 * `settings --allow`.
 */
export async function askPerson(params: ElicitRequestFormParams, context: AskContext | undefined): Promise<ElicitResult> {
  if (!context || !context.hasUI) {
    return { action: 'decline' };
  }
  // The server only offers to remember the answer when it has a file to save it to.
  const canSave = 'always' in (params.requestedSchema?.properties ?? {});
  const options = canSave ? [ALLOW, ALWAYS, DENY] : [ALLOW, DENY];
  let choice: string | undefined;
  try {
    choice = await context.ui.select(params.message, options);
  } catch {
    return { action: 'decline' };
  }
  if (choice === ALLOW) {
    return { action: 'accept', content: { always: false } };
  }
  if (choice === ALWAYS) {
    return { action: 'accept', content: { always: true } };
  }
  return { action: 'decline' };
}
