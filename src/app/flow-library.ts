import fs from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeConfig } from '../config/runtime-config';
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE } from '../runtime/run-store';

/** One flow in the library, without its document. */
export interface SavedFlow {
  name: string;
  /** The absolute path, which `flowPath` takes to run it again. */
  file: string;
  nodes: number;
  savedAt: string;
}

/**
 * The flows the MCP server has run, one file per flow name in
 * `<data dir>/flows/`, so a flow designed in one conversation can be found and
 * run in the next. A flow passed inline would otherwise exist only in the
 * conversation that wrote it. Saving under a name replaces the flow that had
 * that name.
 */
export class FlowLibrary {
  constructor(private readonly config: RuntimeConfig) {}

  get dir(): string {
    return path.join(this.config.dataDir, 'flows');
  }

  /** The file a flow with this name is saved to. */
  fileFor(name: string): string {
    return path.join(this.dir, `${flowSlug(name)}.json`);
  }

  /** Saves the document as written, so loading it again gives the same flow. Returns the file. */
  async save(name: string, document: unknown): Promise<string> {
    await fs.mkdir(this.dir, { recursive: true, mode: PRIVATE_DIR_MODE });
    const file = this.fileFor(name);
    const temp = `${file}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temp, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
      await fs.rename(temp, file);
    } finally {
      await fs.rm(temp, { force: true });
    }
    return file;
  }

  /** Every saved flow, most recently saved first. A file that is not a flow document is left out. */
  async list(): Promise<SavedFlow[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    const flows = await Promise.all(
      entries.filter((entry) => entry.endsWith('.json')).map((entry) => this.describe(path.join(this.dir, entry))),
    );
    return flows
      .filter((flow): flow is SavedFlow => flow !== undefined)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  /** The saved document for a name, or undefined when there is none. */
  async read(name: string): Promise<{ file: string; document: unknown } | undefined> {
    const file = this.fileFor(name);
    try {
      return { file, document: JSON.parse(await fs.readFile(file, 'utf8')) as unknown };
    } catch {
      return undefined;
    }
  }

  private async describe(file: string): Promise<SavedFlow | undefined> {
    try {
      const [text, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
      const document = JSON.parse(text) as { name?: unknown; nodes?: unknown };
      return {
        name: typeof document.name === 'string' ? document.name : path.basename(file, '.json'),
        file,
        nodes: Array.isArray(document.nodes) ? document.nodes.length : 0,
        savedAt: stat.mtime.toISOString(),
      };
    } catch {
      return undefined;
    }
  }
}

/** A flow name as a file name: lower-case letters, digits and dashes, never empty and never a path. */
export function flowSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '');
  return slug || 'flow';
}
