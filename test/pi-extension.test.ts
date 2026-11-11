import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
import { allowedEnvironment, nodeCommand } from "../src/pi/bridge";
import { askPerson } from "../src/pi/elicitation";
import { waitForRun, type WaitDeps } from "../src/pi/wait-run";

const pkgDir = path.resolve("pi-extension");
const dist = path.join(pkgDir, "dist");
const serverBundle = path.join(dist, "server.mjs");

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** PIDs of leafi servers started from this package's bundle. */
function serverPids(): number[] {
  const out = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
  return out
    .split("\n")
    .filter((line) => line.includes(serverBundle) && line.includes("--transport"))
    .map((line) => Number.parseInt(line.trim(), 10));
}

interface FakeTool {
  name: string;
  parameters: unknown;
  execute(id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: unknown, ctx: unknown): Promise<{ content: { type: string; text: string }[] }>;
}

/** The slice of Pi's ExtensionAPI the extension touches. */
function fakePi() {
  const tools = new Map<string, FakeTool>();
  const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
  const handlers = new Map<string, (...args: unknown[]) => Promise<void>>();
  return {
    tools,
    commands,
    handlers,
    api: {
      registerTool(tool: FakeTool) {
        assert.ok(!tools.has(tool.name), `duplicate tool ${tool.name}`);
        tools.set(tool.name, tool);
      },
      registerCommand(name: string, options: { handler(args: string, ctx: unknown): Promise<void> }) {
        commands.set(name, options);
      },
      on(event: string, handler: (...args: unknown[]) => Promise<void>) {
        handlers.set(event, handler);
      },
    },
  };
}

function textOfResult(result: { content: { text: string }[] }): string {
  return result.content.map((block) => block.text).join("\n");
}

async function loadExtension(env: Record<string, string | undefined>) {
  assert.ok(fs.existsSync(serverBundle), "run pnpm build:pi before this test");
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const pi = fakePi();
  const module = await import(`${pathToFileURL(path.join(dist, "index.js")).href}?t=${Math.random()}`);
  module.default(pi.api);
  return {
    pi,
    restore() {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

const cleanEnv = (home: string): Record<string, string | undefined> => ({
  LEAFI_HOME: home,
  LEAFI_ALLOW_BASH: undefined,
  LEAFI_ALLOW_WRITE: undefined,
  LEAFI_ALLOW_WEB: undefined,
  LEAFI_ALLOW_EMAIL: undefined,
  LEAFI_ALLOW_MCP: undefined,
  OPENAI_API_KEY: undefined,
  ANTHROPIC_API_KEY: undefined,
  GOOGLE_API_KEY: undefined,
  OPENROUTER_API_KEY: undefined,
});

test("package metadata is consistent and carries no runtime dependencies", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  assert.equal(manifest.version, JSON.parse(fs.readFileSync("package.json", "utf8")).version);
  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(manifest.pi.extensions, ["./dist/index.js"]);
  assert.deepEqual(manifest.pi.skills, ["./skills"]);
  assert.ok(manifest.keywords.includes("pi-package"));
  for (const entry of ["dist/index.js", "dist/server.mjs", "dist/tools.json", "dist/THIRD_PARTY_NOTICES.md", "skills/leafi/SKILL.md", "LICENSE"]) {
    assert.ok(fs.existsSync(path.join(pkgDir, entry)), `${entry} is missing; run pnpm build:pi`);
  }

  // The bundle may import only Node, Pi's own packages and typebox: anything else would need installing.
  const bundle = fs.readFileSync(path.join(dist, "index.js"), "utf8");
  const bare = [...bundle.matchAll(/^import .*? from ["']([^"']+)["']/gm)].map((m) => m[1] as string).filter((name) => !name.startsWith("node:"));
  for (const name of bare) assert.match(name, /^(typebox|@earendil-works\/)/, `unbundled import ${name}`);

  const skill = fs.readFileSync(path.join(pkgDir, "skills/leafi/SKILL.md"), "utf8");
  assert.match(skill, /^name: leafi$/m);
  assert.doesNotMatch(skill.replace(/<!--[\s\S]*?-->/, ""), /hermes/i);
  assert.match(skill, /`leafi_start_run`/);
  assert.match(skill, /`leafi_wait_run`/);
  assert.doesNotMatch(skill, /`(start_run|get_run|validate_flow)`/);
});

test("loading registers every tool with a unique leafi_ name and starts nothing", async () => {
  const before = serverPids();
  const { pi, restore } = await loadExtension(cleanEnv(makeTempDir("leafi-pi-home-")));
  try {
    const names = [...pi.tools.keys()];
    assert.equal(names.length, 13);
    assert.ok(names.every((name) => name.startsWith("leafi_")));
    assert.ok(names.includes("leafi_wait_run"));
    assert.ok(names.includes("leafi_start_run"));
    assert.ok(pi.commands.has("leafi"));
    assert.ok(pi.handlers.has("session_shutdown"));
    assert.deepEqual(serverPids(), before, "a server was started while loading");
  } finally {
    restore();
  }
});

test("tools reach the real server; permissions fail closed without a UI; shutdown leaves no child", { timeout: 60000 }, async () => {
  const home = makeTempDir("leafi-pi-home-");
  const { pi, restore } = await loadExtension(cleanEnv(home));
  const call = (name: string, params: Record<string, unknown>, ctx: unknown = { hasUI: false }) =>
    (pi.tools.get(name) as FakeTool).execute("id", params, undefined, undefined, ctx);
  try {
    const example = JSON.parse(textOfResult(await call("leafi_get_example_flow", {})));
    const validated = JSON.parse(textOfResult(await call("leafi_validate_flow", { flow: example })));
    assert.equal(validated.ok, true);
    assert.match(validated.diagram, /\w/);

    const pids = serverPids();
    assert.equal(pids.length, 1, "exactly one server after several calls");

    // A flow that needs bash, with the permission off and no UI to ask.
    const bashFlow = structuredClone(example);
    bashFlow.nodes[0].permissions = { ...(bashFlow.nodes[0].permissions ?? {}), bash: true };
    await assert.rejects(call("leafi_start_run", { flow: bashFlow, input: "x" }), /bash/);
    assert.equal(fs.existsSync(path.join(home, "runs")) ? fs.readdirSync(path.join(home, "runs")).length : 0, 0, "a run was created");

    // An unknown run is an error result, not a hang.
    await assert.rejects(call("leafi_get_run", { runId: "nope" }), /No run/);
    await assert.rejects(call("leafi_wait_run", { runId: "nope" }), /No run/);

    const shutdown = pi.handlers.get("session_shutdown") as () => Promise<void>;
    await shutdown();
    await shutdown(); // idempotent
    assert.deepEqual(serverPids().filter((pid) => pids.includes(pid)), [], "the server outlived session_shutdown");

    // The next call starts a fresh one.
    await call("leafi_get_example_flow", {});
    const fresh = serverPids();
    assert.equal(fresh.length, 1);
    assert.notEqual(fresh[0], pids[0]);
    await shutdown();
    assert.deepEqual(serverPids(), []);
  } finally {
    await (pi.handlers.get("session_shutdown") as () => Promise<void>)();
    restore();
  }
});

test("a person's answer is honoured, and Always allow is saved", { timeout: 60000 }, async () => {
  const home = makeTempDir("leafi-pi-home-");
  const { pi, restore } = await loadExtension(cleanEnv(home));
  const example = JSON.parse(
    textOfResult(await (pi.tools.get("leafi_get_example_flow") as FakeTool).execute("id", {}, undefined, undefined, { hasUI: false })),
  );
  example.nodes[0].permissions = { ...(example.nodes[0].permissions ?? {}), bash: true };
  const start = (choice: string | undefined, asked: string[][]) =>
    (pi.tools.get("leafi_start_run") as FakeTool).execute("id", { flow: example, input: "x" }, undefined, undefined, {
      hasUI: true,
      ui: {
        async select(_title: string, options: string[]) {
          asked.push(options);
          return choice;
        },
      },
    });
  try {
    const asked: string[][] = [];
    await assert.rejects(start("Deny", asked), /did not allow/);
    await assert.rejects(start(undefined, asked), /did not allow/); // Esc
    assert.deepEqual(asked[0], ["Allow this run", "Always allow", "Deny"]);

    // Allowed, the flow goes on to start; with no provider key that fails in pre-flight, not at the policy.
    const error = await start("Always allow", asked).then(
      () => "",
      (e: Error) => e.message,
    );
    assert.doesNotMatch(error, /turned off|did not allow|settings --allow/);
    assert.match(fs.readFileSync(path.join(home, ".env"), "utf8"), /LEAFI_ALLOW_BASH=true/);
  } finally {
    await (pi.handlers.get("session_shutdown") as () => Promise<void>)();
    restore();
  }
});

test("elicitation maps the dialog and fails closed", async () => {
  const form = (withAlways: boolean): ElicitRequestFormParams => ({
    mode: "form",
    message: "Allow?",
    requestedSchema: { type: "object", properties: withAlways ? { always: { type: "boolean" } } : {} },
  });
  const ui = (answer: string | undefined | Error) => ({
    hasUI: true,
    ui: {
      async select() {
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  });
  assert.deepEqual(await askPerson(form(true), undefined), { action: "decline" });
  assert.deepEqual(await askPerson(form(true), { hasUI: false, ui: ui("x").ui }), { action: "decline" });
  assert.deepEqual(await askPerson(form(true), ui("Allow this run")), { action: "accept", content: { always: false } });
  assert.deepEqual(await askPerson(form(true), ui("Always allow")), { action: "accept", content: { always: true } });
  assert.deepEqual(await askPerson(form(true), ui("Deny")), { action: "decline" });
  assert.deepEqual(await askPerson(form(true), ui(undefined)), { action: "decline" });
  assert.deepEqual(await askPerson(form(true), ui(new Error("closed"))), { action: "decline" });

  const offered: string[][] = [];
  await askPerson(form(false), { hasUI: true, ui: { async select(_t, options) { offered.push(options); return "Deny"; } } });
  assert.deepEqual(offered, [["Allow this run", "Deny"]]);
});

test("the child environment is an allowlist and Pi's binary is never used as node", () => {
  const env = allowedEnvironment({
    PATH: "/bin",
    HOME: "/home/x",
    OPENAI_API_KEY: "k",
    LEAFI_HOME: "/data",
    LC_ALL: "C",
    AWS_SECRET_ACCESS_KEY: "no",
    GITHUB_TOKEN: "no",
    UNSET: undefined,
  });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LC_ALL", "LEAFI_HOME", "OPENAI_API_KEY", "PATH"]);
  assert.equal(nodeCommand("/usr/local/bin/node"), "/usr/local/bin/node");
  assert.equal(nodeCommand("C:\\Program Files\\nodejs\\node.exe"), "C:\\Program Files\\nodejs\\node.exe");
  assert.equal(nodeCommand("/usr/local/bin/pi"), "node");
});

function fakeRun(statuses: string[], events: object[][]): { deps: WaitDeps; calls: string[] } {
  const calls: string[] = [];
  let poll = 0;
  const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
  return {
    calls,
    deps: {
      async call(name, args) {
        calls.push(`${name}:${JSON.stringify(args)}`);
        if (name === "get_run") {
          return text({ id: "r1", status: statuses[Math.min(poll, statuses.length - 1)] });
        }
        const page = events[Math.min(poll, events.length - 1)] ?? [];
        poll += 1;
        return text({ runId: "r1", events: page });
      },
      sleep: async () => undefined,
    },
  };
}

test("wait_run polls inside the extension, streams progress and returns the finished run", async () => {
  const { deps, calls } = fakeRun(
    ["running", "running", "completed"],
    [
      [{ seq: 0, type: "node_started", nodeId: "a", payload: { label: "Fetch" } }],
      [{ seq: 0, type: "node_started", nodeId: "a", payload: { label: "Fetch" } }, { seq: 1, type: "node_completed", nodeId: "a", payload: {} }],
      [{ seq: 2, type: "run_completed", payload: {} }],
    ],
  );
  const lines: string[] = [];
  const outcome = await waitForRun(deps, { runId: "r1", maxWaitMs: 60000, pollMs: 1, signal: undefined, onProgress: (line) => lines.push(line) });
  assert.equal(outcome.finished, true);
  assert.equal(JSON.parse(outcome.text).status, "completed");
  assert.deepEqual(lines, ["▶ Fetch", "✔ a", "run completed"]);
  // Events are asked for from the first one not yet shown, never from the start again.
  assert.deepEqual(
    calls.filter((call) => call.startsWith("get_run_events")).map((call) => JSON.parse(call.slice(call.indexOf(":") + 1)).afterSeq),
    [0, 1, 2],
  );
});

test("wait_run reports a run that outlasts the wait, and stops on abort without touching the run", async () => {
  const { deps } = fakeRun(["running"], [[]]);
  const outcome = await waitForRun(deps, { runId: "r1", maxWaitMs: 0, pollMs: 1, signal: undefined, onProgress: () => undefined });
  assert.equal(outcome.finished, false);
  assert.match(outcome.text, /still running.*leafi_wait_run again/);

  const controller = new AbortController();
  controller.abort();
  const { deps: second, calls } = fakeRun(["running"], [[]]);
  await assert.rejects(
    waitForRun(second, { runId: "r1", maxWaitMs: 60000, pollMs: 1, signal: controller.signal, onProgress: () => undefined }),
    /Stopped waiting/,
  );
  assert.ok(!calls.some((call) => call.startsWith("cancel_run")));
});
