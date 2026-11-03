import type { NodePermissions } from './types';

/** Every permission a node can hold, in the order the inspector shows them. */
export const PERMISSION_KEYS = [
  'read',
  'write',
  'bash',
  'web',
  'email_read',
  'browser',
] as const satisfies readonly (keyof NodePermissions)[];

/** The permissions that need a mailbox credential before they can do anything. */
export const EMAIL_PERMISSION_KEYS = ['email_read'] as const satisfies readonly (keyof NodePermissions)[];

/**
 * Permissions that were renamed when the Google integration became an IMAP one.
 * A saved graph still carrying the old key would otherwise read as "not granted"
 * and silently lose its mailbox tools, because `readPermissions` only honours an
 * explicit `true` on a key it knows. Drop this once no stored graph predates the
 * rename.
 */
const RENAMED_PERMISSIONS: Record<string, keyof NodePermissions> = {
  gmail_read: 'email_read',
  gmail_send: 'email_read',
};

export function emptyPermissions(): NodePermissions {
  return {
    read: false,
    write: false,
    bash: false,
    web: false,
    email_read: false,
    browser: false,
  };
}

/**
 * Reads a permission object leniently: only an explicit `true` grants anything,
 * so absent, missing and malformed values all deny. Accepts untyped JSON — a
 * request body, a saved graph, or a typed `NodePermissions`.
 */
export function readPermissions(source: unknown): NodePermissions {
  const record = isRecord(source) ? source : {};
  const permissions = emptyPermissions();
  for (const key of PERMISSION_KEYS) {
    permissions[key] = record[key] === true;
  }
  for (const [legacy, current] of Object.entries(RENAMED_PERMISSIONS)) {
    permissions[current] ||= record[legacy] === true;
  }
  return permissions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function grantsAny(permissions: Partial<NodePermissions>, keys: readonly (keyof NodePermissions)[]): boolean {
  return keys.some((key) => permissions[key] === true);
}

export function usesEmail(permissions: Partial<NodePermissions>): boolean {
  return grantsAny(permissions, EMAIL_PERMISSION_KEYS);
}
