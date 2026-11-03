import type { ImapFlow } from 'imapflow';
import type { FetchMessageObject, MessageAddressObject, MessageStructureObject } from 'imapflow/lib/types.js';
import { EmailNotFoundError } from './email-errors';
import { compactUrls, htmlToText, optionalPositiveInt, requireString } from '../tools/text';

const SUMMARY_LIMIT = 10;
const MAX_SUMMARY_LIMIT = 25;
/** Bound on what one body fetch pulls from the server, before the output cap. */
const MAX_BODY_BYTES = 128 * 1024;
/** A note needs the specifics, not the whole newsletter; bounds what one read puts in context. */
export const MESSAGE_PREVIEW_BYTES = 4 * 1024;
/** Gmail's extension, which lets the mailbox's own search syntax be used as-is. */
const GMAIL_EXTENSION = 'X-GM-EXT-1';

export interface SearchArgs {
  query: string;
  maxResults?: number;
}

export interface GetArgs {
  uid: number;
}

/**
 * Lists messages matching `query`, newest first, as one line each. Only
 * envelopes are fetched — no body byte crosses the wire — so this stays cheap
 * enough to re-send on every iteration of the agent loop.
 */
export async function searchMessages(client: ImapFlow, args: Record<string, unknown>): Promise<string> {
  const query = requireString(args, 'query');
  const maxResults = optionalPositiveInt(args, 'maxResults', { fallback: SUMMARY_LIMIT, max: MAX_SUMMARY_LIMIT });

  const found = await client.search(searchQuery(client, query), { uid: true });
  // A server answering with an ESEARCH object (or nothing) is not a match list.
  const uids = Array.isArray(found) ? found : [];
  if (uids.length === 0) {
    return `No messages match "${query}".`;
  }

  // SEARCH returns matching message numbers in ascending order (RFC 3501), so the
  // newest are at the end.
  const newest = uids.slice(-maxResults).reverse();
  const messages = await client.fetchAll(newest, { uid: true, all: true }, { uid: true });
  const byUid = new Map(messages.map((message) => [message.uid, message]));
  // Re-ordered against `newest` rather than trusting the server's response order.
  const lines = newest.flatMap((uid) => {
    const message = byUid.get(uid);
    return message ? [formatSummary(message)] : [];
  });

  return lines.join('\n');
}

/** Reads one message by UID: its headers and its readable text body, uncapped. */
export async function getMessage(client: ImapFlow, args: Record<string, unknown>): Promise<string> {
  const uid = requireUid(args, 'uid');
  const message = await client.fetchOne(uid, { uid: true, envelope: true, bodyStructure: true }, { uid: true });
  if (!message) {
    throw new EmailNotFoundError(`No message with UID ${uid} in this mailbox.`);
  }

  const envelope = message.envelope;
  const header = [
    `From: ${formatAddresses(envelope?.from)}`,
    `To: ${formatAddresses(envelope?.to)}`,
    `Date: ${formatDate(message.internalDate ?? envelope?.date)}`,
    `Subject: ${envelope?.subject?.trim() || '(no subject)'}`,
  ].join('\n');

  return `${header}\n\n${await readBody(client, uid, message.bodyStructure)}`;
}

/**
 * Gmail's X-GM-RAW accepts the mailbox's own search syntax ("is:unread
 * newer_than:7d"). Any other server gets a plain full-text search, which is a
 * thinner query language but the honest best available.
 */
function searchQuery(client: ImapFlow, query: string) {
  return client.capabilities.has(GMAIL_EXTENSION) ? { gmraw: query } : { text: query };
}

async function readBody(client: ImapFlow, uid: number, structure: MessageStructureObject | undefined): Promise<string> {
  const part = structure ? findTextPart(structure) : undefined;
  if (!part) {
    return '(no readable text body found in this message)';
  }

  const downloaded = await client.download(uid, part.id, { uid: true, maxBytes: MAX_BODY_BYTES });
  if (!downloaded.content) {
    return '(the message body could not be downloaded)';
  }

  const raw = await readStream(downloaded.content);
  // `download()` has already undone the transfer encoding and converted the
  // charset; `meta.encoding`/`meta.charset` describe the part as sent, not the
  // stream, so decoding again would mangle it.
  const text = compactUrls(raw.toString('utf8'));
  return part.html ? htmlToText(text) : text.trim();
}

interface TextPart {
  id: string;
  html: boolean;
}

/**
 * The preferred text part: `text/plain` when the message has one, `text/html`
 * otherwise. Attachments are skipped whatever their type, so an attached .txt or
 * a forwarded .eml is never mistaken for the message body.
 */
function findTextPart(structure: MessageStructureObject): TextPart | undefined {
  const plain: string[] = [];
  const html: string[] = [];

  const visit = (node: MessageStructureObject, isRoot: boolean): void => {
    if (node.disposition?.toLowerCase() === 'attachment') {
      return;
    }
    const type = node.type.toLowerCase();
    // imapflow numbers only a multipart's children; a single-part message's body
    // is part "1", which download() maps to TEXT.
    const id = node.part ?? (isRoot && !node.childNodes ? '1' : undefined);
    if (id && type === 'text/plain') {
      plain.push(id);
    }
    if (id && type === 'text/html') {
      html.push(id);
    }
    for (const child of node.childNodes ?? []) {
      visit(child, false);
    }
  };
  visit(structure, true);

  const id = plain[0] ?? html[0];
  return id === undefined ? undefined : { id, html: plain.length === 0 };
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

function formatSummary(message: FetchMessageObject): string {
  const envelope = message.envelope;
  const unread = message.flags?.has('\\Seen') === false ? ' [unread]' : '';
  return `${message.uid} · ${formatDate(message.internalDate ?? envelope?.date)} · ${formatAddresses(envelope?.from)} · ${envelope?.subject?.trim() || '(no subject)'}${unread}`;
}

function formatAddresses(addresses: MessageAddressObject[] | undefined): string {
  if (!addresses || addresses.length === 0) {
    return '(unknown)';
  }
  return addresses
    .flatMap((entry) => {
      const address = entry.address?.trim();
      if (!address) {
        return [];
      }
      const name = entry.name?.trim();
      return [name ? `${name} <${address}>` : address];
    })
    .join(', ');
}

function formatDate(value: Date | string | undefined): string {
  if (value === undefined) {
    return '(unknown date)';
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function requireUid(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`"${key}" must be the positive message UID returned by email_search.`);
  }
  return Math.trunc(parsed);
}
