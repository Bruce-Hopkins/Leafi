import fs from 'node:fs/promises';
import path from 'node:path';
import { isInside } from '../domain/paths';

export class WorkspaceEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceEscapeError';
  }
}

/**
 * The file jail for a single run. Every path `read_file` and `write_file` touch
 * is resolved against the workspace root and rejected when it escapes —
 * including through `..` or symlinks. `run_bash` is not confined by this class.
 */
export class Workspace {
  private constructor(
    readonly root: string,
    private readonly rootReal: string,
  ) {}

  static async open(root: string): Promise<Workspace> {
    await fs.mkdir(root, { recursive: true });
    return new Workspace(root, await fs.realpath(root));
  }

  async resolve(target: string): Promise<string> {
    if (typeof target !== 'string' || target.trim().length === 0) {
      throw new WorkspaceEscapeError('A file path is required.');
    }

    const absolute = path.isAbsolute(target) ? path.resolve(target) : path.resolve(this.rootReal, target);
    const resolved = await realpathOfNearestExisting(absolute);

    if (!isInside(this.rootReal, resolved)) {
      throw new WorkspaceEscapeError(`"${target}" resolves outside the run workspace.`);
    }
    return resolved;
  }
}

/**
 * Real paths the deepest existing ancestor, then re-attaches the still-missing
 * path segments. A write to a new file is therefore judged by the directory it
 * will land in, and a symlinked ancestor cannot smuggle the path out.
 */
async function realpathOfNearestExisting(absolute: string): Promise<string> {
  const missing: string[] = [];
  let current = absolute;

  for (;;) {
    try {
      await fs.lstat(current);
      const real = await fs.realpath(current);
      return path.resolve(real, ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return absolute;
      }
      missing.push(path.basename(current));
      current = parent;
    }
  }
}
