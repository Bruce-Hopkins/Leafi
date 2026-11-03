import path from 'node:path';

/** True when `candidate` is `root` or sits below it, judged on the resolved path. */
export function isInside(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * `name` resolved under `root`, or undefined when it would leave it. An empty
 * name resolves to `root` itself, which callers do not want as a child path.
 */
export function childPath(root: string, name: string): string | undefined {
  const base = path.resolve(root);
  const resolved = path.resolve(base, name);
  return resolved !== base && isInside(base, resolved) ? resolved : undefined;
}
