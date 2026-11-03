import fs from 'node:fs/promises';
import path from 'node:path';
import type { NodePermissions } from '../domain/types';
import type { Workspace } from './workspace';

/** Where oversized tool results are saved, relative to the run workspace. */
export const TOOL_OUTPUT_DIR = '.tool-output';

/** How a node can read a saved result back: its own tools decide. */
export type SavedOutputReader = 'read_file' | 'bash';

/** `read_file` when the node has it, since it pages exactly; otherwise the shell. */
export function readerFor(permissions: NodePermissions): SavedOutputReader | undefined {
  if (permissions.read) {
    return 'read_file';
  }
  return permissions.bash ? 'bash' : undefined;
}

export interface ToolOutputOptions {
  workspace: Workspace;
  nodeId: string;
  /** The most one tool result may return to the model. */
  limitBytes: number;
  /** The most a saved result may hold. Never below `limitBytes`. */
  saveLimitBytes: number;
  /** Absent when the node holds neither `read` nor `bash`: a saved file would be unreachable. */
  reader?: SavedOutputReader;
  /** The most all results of one model response may return together; stated in tool descriptions. */
  stepLimitBytes?: number;
}

export interface CapOptions {
  /** A smaller preview than `limitBytes`, for tools that keep their results short. */
  previewBytes?: number;
  /** The producer stopped collecting at the save limit, so the true size is unknown. */
  overflowed?: boolean;
  /** Tool-specific advice appended to the note. */
  hint?: string;
  /** Show the end as well as the start, for command output, where errors come last. */
  keepEnd?: boolean;
  /** The true last bytes of the output, when the producer stopped collecting before the end. */
  ending?: Buffer;
}

/** With `keepEnd`, the share of the preview given to the start; the rest shows the end. */
const START_SHARE = 0.4;

/**
 * Caps every tool result of one node at the same budget. A result over the cap
 * returns its first piece; the whole result, up to the save limit, goes to a
 * workspace file the node can read on from, so nothing is lost and every extra
 * byte the model reads is one it asked for.
 */
export class ToolOutput {
  readonly limitBytes: number;
  readonly saveLimitBytes: number;
  private saved = 0;

  constructor(private readonly options: ToolOutputOptions) {
    this.limitBytes = options.limitBytes;
    this.saveLimitBytes = Math.max(options.saveLimitBytes, options.limitBytes);
  }

  /** Whether oversized results are saved; a producer may then collect up to `saveLimitBytes`. */
  get saving(): boolean {
    return this.options.reader !== undefined;
  }

  /** One sentence for a tool description, so the model knows the budget before it calls. */
  describe(): string {
    const cut = `A result over ${this.limitBytes} bytes is cut to ${this.limitBytes} bytes, with a note at the top saying so`;
    const step = this.options.stepLimitBytes
      ? ` All results of one response together return at most ${this.options.stepLimitBytes} bytes.`
      : '';
    if (this.options.reader === 'read_file') {
      return `${cut}, and the full result, up to ${this.saveLimitBytes} bytes, is saved to a file in ${TOOL_OUTPUT_DIR}/ that you can read on from with read_file and offset.${step}`;
    }
    if (this.options.reader === 'bash') {
      return `${cut}, and the full result, up to ${this.saveLimitBytes} bytes, is saved to a file in ${TOOL_OUTPUT_DIR}/ that you can read on from with tail -c and head -c.${step}`;
    }
    return `${cut}; the rest is not kept, so ask for less.${step}`;
  }

  /**
   * Returns `text` whole when it fits, otherwise a note saying what was cut and
   * where the rest is, followed by the first piece (and, with `keepEnd`, the
   * last). The note comes first so the model knows before it reads that it has
   * only part of the result.
   */
  async cap(tool: string, text: string, options: CapOptions = {}): Promise<string> {
    const buffer = Buffer.from(text, 'utf8');
    const previewLimit = Math.min(options.previewBytes ?? this.limitBytes, this.limitBytes);
    if (buffer.byteLength <= previewLimit && !options.overflowed) {
      return text;
    }

    const ending = options.keepEnd ? (options.ending ?? buffer) : undefined;
    const startLimit = ending ? Math.floor(previewLimit * START_SHARE) : previewLimit;
    const shown = pieceEnd(buffer, 0, startLimit);
    const start = buffer.subarray(0, shown).toString('utf8');
    const endPiece = ending ? endingPiece(ending, previewLimit - shown, options.ending ? 0 : shown) : undefined;
    const size = options.overflowed ? `more than ${this.saveLimitBytes}` : `${buffer.byteLength}`;
    const notes = [
      endPiece
        ? `showing the first ${shown} and the last ${endPiece.byteLength} of ${size} bytes`
        : `showing the first ${shown} of ${size} bytes`,
    ];

    if (this.options.reader) {
      const kept = buffer.subarray(0, this.saveLimitBytes);
      const file = await this.save(tool, kept);
      const lost = options.overflowed || buffer.byteLength > kept.byteLength;
      notes.push(`the ${lost ? `first ${kept.byteLength} bytes are` : 'full output is'} saved to ${file}`);
      notes.push(
        this.options.reader === 'read_file'
          ? `continue with read_file path="${file}" offset=${shown}`
          : `continue with: tail -c +${shown + 1} ${file} | head -c ${this.limitBytes}`,
      );
    } else {
      notes.push('the rest was not kept');
    }
    if (options.hint) {
      notes.push(options.hint);
    }
    // Trailing line breaks around the gap are noise; the counts above are exact.
    const body = endPiece ? `${start.trimEnd()}\n[…]\n${endPiece.toString('utf8').trimEnd()}` : start;
    return `[${notes.join('; ')}]\n${body}`;
  }

  private async save(tool: string, content: Buffer): Promise<string> {
    // The node id keeps two nodes running at once from writing the same file.
    this.saved += 1;
    const name = `${fileSafe(this.options.nodeId)}-${fileSafe(tool)}-${this.saved}.txt`;
    const dir = path.join(this.options.workspace.root, TOOL_OUTPUT_DIR);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), content);
    return `${TOOL_OUTPUT_DIR}/${name}`;
  }
}

/**
 * The end of a piece starting at `start` and at most `limit` bytes long. It
 * never splits a UTF-8 character, and ends after a line break when one falls in
 * the second half of the piece, so the model gets whole lines.
 */
export function pieceEnd(buffer: Buffer, start: number, limit: number): number {
  const max = Math.min(buffer.byteLength, start + limit);
  if (max === buffer.byteLength) {
    return max;
  }
  const newline = buffer.lastIndexOf(0x0a, max - 1);
  if (newline >= start + Math.floor(limit / 2)) {
    return newline + 1;
  }
  const end = characterStart(buffer, max);
  // A limit smaller than one character still returns that character, so reading on always advances.
  return end > start ? end : characterEnd(buffer, start);
}

/**
 * The last `limit` bytes of `buffer`, never before `floor`, starting at a whole
 * character and, when one falls in the first half, just after a line break.
 */
function endingPiece(buffer: Buffer, limit: number, floor: number): Buffer {
  let start = Math.max(floor, buffer.byteLength - Math.max(0, limit));
  while (start < buffer.byteLength && ((buffer[start] ?? 0) & 0xc0) === 0x80) {
    start += 1;
  }
  const newline = buffer.indexOf(0x0a, start);
  if (newline !== -1 && newline < start + Math.floor(limit / 2)) {
    start = newline + 1;
  }
  return buffer.subarray(start);
}

function characterEnd(buffer: Buffer, start: number): number {
  let at = start + 1;
  while (at < buffer.byteLength && ((buffer[at] ?? 0) & 0xc0) === 0x80) {
    at += 1;
  }
  return at;
}

/** Moves `index` back to the first byte of the UTF-8 character it falls inside. */
function characterStart(buffer: Buffer, index: number): number {
  let at = index;
  // Continuation bytes look like 10xxxxxx; a character is at most four bytes.
  while (at > 0 && index - at < 3 && ((buffer[at] ?? 0) & 0xc0) === 0x80) {
    at -= 1;
  }
  return at;
}

function fileSafe(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 64) || 'node';
}
