import type { ChildProcess } from 'node:child_process';

/** Spawn option that makes a child lead its own process group, where groups exist. */
export const OWN_PROCESS_GROUP = process.platform !== 'win32';

/**
 * Signals a detached child's whole process group, falling back to the child
 * alone where there are no groups (Windows) or the group is already gone.
 */
export function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid !== undefined && OWN_PROCESS_GROUP) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The group has exited; fall through to the child itself.
    }
  }
  child.kill(signal);
}
