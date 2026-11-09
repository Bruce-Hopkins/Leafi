# Plan: leafi as a Pi extension

> **Delete this file once the plan is implemented.** It is a working plan, not documentation. When the Pi extension is built, tested and published, remove `pi-plugin-integration.md`. The lasting docs belong in `pi-extension/README.md` and the root README.

Source guide: `~/Downloads/pi-extension-guide.md` (Pi = the Pi coding agent by Mario Zechner / Earendil, not Inflection's Pi).

## Architecture

Running leafi inside Pi's own process would cause problems: `loadEnvironment()` writes `~/.leafi/.env` into `process.env` and `disableImplicitTracing()` deletes variables from it, so Pi would end up with leafi's provider keys. The 8.4 MB langchain bundle would also load through jiti, and `policy.ts` and `permission-request.ts` build their "run this to allow it" messages from `process.argv[1]`. Pi has no MCP support of its own.

So the extension is a thin bridge that starts the existing leafi MCP server as a child process, the same way the Hermes plugin does. It does not import `src/app` directly.

```
Pi process                                   child process (spawned on first use)
┌───────────────────────────────┐            ┌──────────────────────────────┐
│ pi-extension/dist/index.js    │  stdio     │ dist/server.mjs --transport  │
│  • 12 leafi_* tools (static)  │ ─MCP────▶  │   stdio  (same bundle as     │
│  • leafi_wait_run (client-side)│ ◀─elicit─ │   Hermes; reads ~/.leafi)    │
│  • /leafi command             │            └──────────────────────────────┘
│  • session_shutdown → close   │
└───────────────────────────────┘
```

- **No change to the leafi engine.** All 12 tools in `src/mcp/registry.ts`, the policy, saved flows, the run store and the "always allow" setting work as they do now.
- **Tools are registered when the extension loads; the server starts later.** The build turns each zod `inputSchema` into JSON Schema (`z.toJSONSchema`) and writes a `tools.json` manifest. `index.ts` registers each tool with `Type.Unsafe(schema)`. Nothing starts in the main function (guide, Step 4). The first tool call starts the server and later calls reuse it.

## Files

```
src/pi/
  index.ts        default export: register tools, the /leafi command, session_shutdown
  bridge.ts       starts the server once, Client + StdioClientTransport, close()
  elicitation.ts  maps MCP form elicitation to ctx.ui.select (declines when there is no UI)
  wait-run.ts     leafi_wait_run: polls get_run inside the extension, streams progress with onUpdate
  commands.ts     /leafi runs | cancel <id> | status | settings
scripts/build-pi-extension.mjs
pi-extension/
  package.json    { name, version, pi: { extensions: ["./dist/index.js"], skills: ["./skills"] } }, no dependencies
  README.md       install steps, security note, provider key setup
  LICENSE
  dist/index.js, dist/server.mjs, dist/tools.json, dist/THIRD_PARTY_NOTICES.md
  skills/leafi/SKILL.md   generated from the Hermes skill, with tool names renamed
test/pi-extension.test.ts
```

## Steps

1. **Build script** (`scripts/build-pi-extension.mjs`), modelled on `build-hermes-plugin.mjs`:
   - Bundle `src/mcp/main.ts` into `pi-extension/dist/server.mjs`. Move the bundle and notices code into a shared helper so both build scripts use it.
   - Bundle `src/pi/index.ts` into `dist/index.js` (ESM) with `@earendil-works/*` and `typebox` external. The `@modelcontextprotocol/sdk` client goes inside the bundle, so the package has no runtime dependencies.
   - Write `tools.json` from `TOOLS`, the generated `SKILL.md`, and the version from the root `package.json`.
   - Add `build:pi` and `test:pi` scripts, and devDependencies on `@earendil-works/pi-coding-agent` and `typebox` so the code type-checks.

2. **Bridge** (`bridge.ts`):
   - One memoized `ensureClient()`. It spawns `node <pkgdir>/dist/server.mjs --transport stdio` without `--no-env`, so the server reads `~/.leafi/.env` and "always allow" saves to that file.
   - Runs, flows and settings live in `~/.leafi`, the same place the CLI uses.
   - The child's environment is an allowlist: `PATH`, `HOME`, locale, the four provider keys and `LEAFI_*` (copy the env block in `hermes-plugin/mcp.json`).
   - Each tool call passes Pi's `signal` to `client.callTool`. The MCP `CallToolResult` maps almost 1:1 to Pi's `{ content, details }`, with `isError` carried over.
   - Use `process.execPath` only when it really is Node, otherwise `node` on PATH. If Pi is a compiled binary, `execPath` is Pi itself (see the Bun findings in memory).

3. **Permissions** (`elicitation.ts`): when the server asks, call `ctx.ui.select` with *Allow this run*, *Always allow* or *Deny*, and return `{action, content:{always}}`.
   - If `!ctx.hasUI` (print or RPC mode) or the dialog throws, return `decline`. The server then fails closed with its usual message naming `settings --allow`.
   - Use the `ctx` of the tool call that triggered the question, never a stored one.

4. **Tool names:** register as `leafi_<name>` (for example `leafi_start_run`). Plain names like `get_run` are likely to clash with other extensions, and duplicate tool names stop Pi from starting. The build rewrites the backticked tool names in the generated SKILL.md to match.

5. **`leafi_wait_run`** (new, Pi only): takes `runId`, calls `get_run` and `get_run_events` every few seconds inside the extension.
   - Streams node progress through `onUpdate` and returns the final run once the status is no longer `running`.
   - Esc stops the wait, not the run.
   - This replaces the model polling `get_run` in a loop (AGENTS.md: "Never spend model calls waiting"). The skill should tell the model to call it after `start_run`.

6. **`/leafi` command:**
   - `runs` lists recent runs.
   - `cancel <id>` cancels a run.
   - `status` shows whether the server is running, its data directory and which providers are configured.
   - `settings` prints the current permissions and the `server.mjs settings --allow …` command. It does not edit the file from inside the TUI.

7. **Lifecycle:** an idempotent `session_shutdown` handler calls `client.close()`. That sends SIGTERM to the child, whose handler cancels active runs, and they are stored as cancelled. Clear the memoized client so the next session starts a fresh server.

8. **Tests** (`test/pi-extension.test.ts`): load `dist/index.js` with a fake `ExtensionAPI` and check that:
   - all 13 tools are registered with unique `leafi_` names;
   - `leafi_validate_flow` with the `schema example` flow returns `ok: true` from the real `server.mjs`;
   - elicitation with `hasUI: false` declines and `start_run` gets the policy error;
   - after `session_shutdown`, no child process is left.

9. **Manual testing in Pi** (guide, Step 6):
   - `pi -e ./pi-extension/dist/index.js` in the TUI and with `-p`;
   - a flow that needs `bash`, to see the permission dialog;
   - after quitting, `/reload` and `/new`, `pgrep -f server.mjs` finds nothing.

10. **Docs and publishing:**
    - README with a security note and setup. Run `server.mjs init` in a normal terminal, since it needs a TTY that Pi's TUI holds.
    - Add a Pi section to the root README and the site.
    - Read https://pi.dev/docs/latest/packages before publishing; the guide did not cover it.
    - Later, `init`'s agent checklist could offer to run `pi install`.

## Things to know

- **`/new` and `/reload` cancel runs that are still going.** The guide requires that nothing keeps running after a session ends. A detached server that outlives the session would avoid this but breaks that rule. Accept it and say so in the README.
- **Install from npm, not git.** `pi install git:…` on this repo would install the root `package.json` (langchain and the rest). Publish `pi-extension/` as its own npm package with no dependencies.
- **Check in the Pi docs:** whether `pi.skills` accepts a `skills/<name>/SKILL.md` folder, and whether tools can be registered after load (the manifest approach avoids the second question).

## Decisions still open

1. **Package name:** suggested `pi-leafi`, published from `pi-extension/`.
2. **Tool prefix:** suggested `leafi_`.
3. **Runs on `/new`:** cancel them (recommended), or keep the server alive across sessions.

## Done when

- [ ] `pnpm build:pi` produces `pi-extension/dist/*` with no runtime dependencies
- [ ] `pnpm test:pi` and `pnpm typecheck` pass
- [ ] Manual checks in step 9 pass in TUI and `-p` mode
- [ ] Guide checklist (section 4 of the Pi guide) is satisfied
- [ ] `pi-extension/README.md` and the root README cover install and security
- [ ] **This file (`pi-plugin-integration.md`) is deleted**
