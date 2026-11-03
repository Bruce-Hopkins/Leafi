import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const SCRIPT = path.resolve('install.sh');
const SERVER = path.resolve('hermes-plugin/dist/server.mjs');
const unix = { skip: process.platform === 'win32' ? 'install.sh is for macOS, Linux and WSL2' : false };
const tempDirs: string[] = [];

test.after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A stand-in for an agent's command that only logs that it was called. */
const FAKE_AGENT = `#!/bin/sh
echo "$(basename "$0") $*" >> "$FAKE_LOG"
`;

interface Machine {
  home: string;
  bin: string;
  log: string;
}

/** A home folder of its own, with stand-ins for Hermes and Claude Code on the PATH. */
function machine(): Machine {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-automations-install-'));
  tempDirs.push(home);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  for (const name of ['hermes', 'claude']) {
    fs.writeFileSync(path.join(bin, name), FAKE_AGENT, { mode: 0o755 });
  }
  fs.mkdirSync(path.join(home, '.cursor'));
  return { home, bin, log: path.join(home, 'agents.log') };
}

/** Runs the script with stderr piped, so it has no terminal and asks nothing, as in CI or under an agent. */
function install(m: Machine, extra: NodeJS.ProcessEnv = {}) {
  return spawnSync('sh', [SCRIPT], {
    encoding: 'utf8',
    input: '',
    env: {
      // Only the stand-ins, node and the system tools: never a real agent.
      PATH: [m.bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
      HOME: m.home,
      FAKE_LOG: m.log,
      AGENTS_AUTOMATIONS_SERVER_URL: pathToFileURL(SERVER).href,
      ...extra,
    },
  });
}

test('install.sh downloads the server, and without a terminal installs into no agent', unix, () => {
  const m = machine();
  const result = install(m);

  assert.equal(result.status, 0, result.stderr);
  const dir = path.join(m.home, '.agents-automations');
  const server = path.join(dir, 'server.mjs');
  assert.ok(fs.readFileSync(server).equals(fs.readFileSync(SERVER)), 'the downloaded server is the bundle');
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(dir), ['server.mjs'], 'no partial download and no settings are left behind');
  assert.equal(fs.existsSync(m.log), false, 'no agent command was run');
  assert.equal(fs.existsSync(path.join(m.home, '.cursor', 'mcp.json')), false);
  assert.match(result.stderr, /nothing was installed into an agent/);
  assert.ok(result.stderr.includes(`node "${server}" init`), result.stderr);
});

test('install.sh links the agents-automations command to the server, which runs the flow commands', unix, () => {
  const m = machine();
  const result = install(m);

  assert.equal(result.status, 0, result.stderr);
  const server = path.join(m.home, '.agents-automations', 'server.mjs');
  const command = path.join(m.home, '.local', 'bin', 'agents-automations');
  assert.equal(fs.readlinkSync(command), server);
  assert.ok(result.stderr.includes(`Linked the agents-automations command: ${command}`), result.stderr);

  // The folder is not on the test's PATH, so the script says how to add it.
  assert.ok(result.stderr.includes(`${path.dirname(command)} is not on your PATH`), result.stderr);
  assert.ok(result.stderr.includes(`export PATH="${path.dirname(command)}:$PATH"`), result.stderr);

  const example = spawnSync(command, ['schema', 'example'], { encoding: 'utf8' });
  assert.equal(example.status, 0, example.stderr);
  const validated = spawnSync(command, ['validate', '--graph', '-'], { encoding: 'utf8', input: example.stdout });
  assert.equal(validated.status, 0, validated.stderr);
  assert.equal(JSON.parse(validated.stdout).ok, true);
});

test('install.sh puts the command in AGENTS_AUTOMATIONS_BIN_DIR, and says nothing about a PATH that has it', unix, () => {
  const m = machine();
  const binDir = path.join(m.home, 'tools');
  const result = install(m, { AGENTS_AUTOMATIONS_BIN_DIR: binDir, PATH: [binDir, m.bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readlinkSync(path.join(binDir, 'agents-automations')), path.join(m.home, '.agents-automations', 'server.mjs'));
  assert.equal(fs.existsSync(path.join(m.home, '.local')), false);
  assert.doesNotMatch(result.stderr, /not on your PATH|comes first on your PATH/);
});

test('install.sh warns when another agents-automations comes first on the PATH', unix, () => {
  const m = machine();
  const binDir = path.join(m.home, 'tools');
  fs.writeFileSync(path.join(m.bin, 'agents-automations'), FAKE_AGENT, { mode: 0o755 });
  const result = install(m, { AGENTS_AUTOMATIONS_BIN_DIR: binDir, PATH: [m.bin, binDir, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stderr.includes(`Note: ${path.join(m.bin, 'agents-automations')} comes first on your PATH`), result.stderr);
});

test('running install.sh again replaces the server', unix, () => {
  const m = machine();
  const server = path.join(m.home, '.agents-automations', 'server.mjs');
  fs.mkdirSync(path.dirname(server));
  fs.writeFileSync(server, 'old');

  assert.equal(install(m).status, 0);
  assert.ok(fs.readFileSync(server).equals(fs.readFileSync(SERVER)));
});

test('install.sh stops with a message when the download fails', unix, () => {
  const m = machine();
  const result = install(m, { AGENTS_AUTOMATIONS_SERVER_URL: pathToFileURL(path.join(m.home, 'missing.mjs')).href });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not download/);
});

test('install.sh refuses a Node.js older than 22', unix, () => {
  const m = machine();
  fs.writeFileSync(path.join(m.bin, 'node'), '#!/bin/sh\necho 20\n', { mode: 0o755 });

  const result = install(m);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Node\.js 22 or newer is required/);
  assert.equal(fs.existsSync(path.join(m.home, '.agents-automations')), false);
});
