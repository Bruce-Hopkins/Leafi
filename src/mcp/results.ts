import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface McpResults {
  json(value: unknown): CallToolResult;
  text(value: string): CallToolResult;
  error(message: string): CallToolResult;
}

/** One place formats tool results, so size caps and envelope shape cannot drift. */
export function createMcpResults(maxResultBytes: number): McpResults {
  return {
    json(value) {
      const text = JSON.stringify(value, null, 2);
      if (Buffer.byteLength(text, 'utf8') <= maxResultBytes) {
        const result: CallToolResult = { content: [{ type: 'text', text }] };
        if (isPlainObject(value)) {
          result.structuredContent = value;
        }
        return result;
      }
      const preview = Buffer.from(text, 'utf8').subarray(0, maxResultBytes).toString('utf8');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              truncated: true,
              maxBytes: maxResultBytes,
              note: 'The result exceeded the server limit. Request less data, e.g. a smaller event page.',
              preview,
            }),
          },
        ],
      };
    },
    text(value) {
      return { content: [{ type: 'text', text: cap(value, maxResultBytes) }] };
    },
    error(message) {
      return { isError: true, content: [{ type: 'text', text: message }] };
    },
  };
}

function cap(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }
  const truncated = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
  return `${truncated}\n[truncated at ${maxBytes} bytes]`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
