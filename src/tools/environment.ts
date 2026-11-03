import path from 'node:path';

/** Names a child process needs to behave normally and that carry no secret. */
const PORTABLE_ENV = ['PATH', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ', 'DISPLAY'];

/** Windows keeps its own set: without these the shell and Node cannot start. */
const WINDOWS_ENV = [
  'SystemRoot',
  'SystemDrive',
  'windir',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMDATA',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PROCESSOR_ARCHITECTURE',
];

/** Extra names a person may forward to child processes, on purpose. */
export const ENV_PASSTHROUGH = 'AGENT_ENV_PASSTHROUGH';

export interface ChildEnvironmentOptions {
  /** Directory the child should treat as home, with temp files under `<home>/tmp`. */
  home?: string;
  /** Extra variable names to forward, on top of `AGENT_ENV_PASSTHROUGH`. */
  passthrough?: readonly string[];
}

/**
 * The environment a child process sees: an allowlist, not the parent's
 * environment minus a few suffixes. Provider keys, the mailbox password and
 * every other host secret stay out unless named in `AGENT_ENV_PASSTHROUGH`.
 * With `home` set, the child's home and temp directories point inside it.
 */
export function childEnvironment({ home, passthrough = [] }: ChildEnvironmentOptions = {}): NodeJS.ProcessEnv {
  const names = new Set([
    ...PORTABLE_ENV,
    ...(process.platform === 'win32' ? WINDOWS_ENV : []),
    ...passthrough,
    ...readPassthrough(),
  ]);
  const env: NodeJS.ProcessEnv = {};
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value.length > 0) {
      env[name] = value;
    }
  }

  if (home) {
    const tmp = path.join(home, 'tmp');
    env.HOME = home;
    env.USERPROFILE = home;
    env.TMPDIR = tmp;
    env.TMP = tmp;
    env.TEMP = tmp;
  }
  return env;
}

function readPassthrough(): string[] {
  const raw = process.env[ENV_PASSTHROUGH]?.trim();
  return raw ? raw.split(',').map((name) => name.trim()).filter((name) => name.length > 0) : [];
}
