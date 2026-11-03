# MCP server

The MCP server exposes the flow engine over the Model Context Protocol. It is
`server.mjs` when installed by the installer or the Hermes plugin, and
`agents-automations-mcp` from a clone. It uses the official
`@modelcontextprotocol/sdk` and stdio transport. HTTP is not implemented yet.

## Client configuration

The installer (see the README) downloads the server, a single file, to
`~/.agents-automations/server.mjs`. Its `init` adds the server to the agents you
tick: Claude Code with `claude mcp add --scope user`, Claude Desktop and Cursor
in their `mcpServers` files. By hand, or for another client:

```bash
claude mcp add --scope user agents-automations -- node /home/you/.agents-automations/server.mjs --transport stdio
```

```json
{
  "mcpServers": {
    "agents-automations": {
      "command": "node",
      "args": ["/home/you/.agents-automations/server.mjs", "--transport", "stdio"]
    }
  }
}
```

From a clone, point `args` at `dist/mcp/main.js` instead, or put the checkout
on your PATH (`pnpm add -g "link:$PWD"`) and use:

```json
{
  "mcpServers": {
    "agents-automations": {
      "command": "agents-automations-mcp",
      "args": ["--transport", "stdio"]
    }
  }
}
```

Server flags:

```text
--transport stdio       Required; the only supported transport.
--env-file <path>       Load a specific env file instead of <data dir>/.env.
--data-dir <path>       Override the run artifact root.
--no-env                Do not load any env file; use the process environment only.
```

stdout carries MCP JSON-RPC only. All logs go to stderr.

`init [--env-file <path>]` is the setup the installer runs. It needs a
terminal; without one it exits `1`, installs nothing and writes nothing.

1. A checklist of the agents on this machine: Hermes and Claude Code when
   their command is on the PATH, Claude Desktop and Cursor when their settings
   folder exists. Each starts ticked, and only ticked ones are changed.
2. One provider key, with the input hidden.
3. A checklist of every `AGENTS_AUTOMATIONS_ALLOW_*` permission: web, write,
   bash, email, browser and flow paths. Each starts ticked unless a file
   already sets it, so pressing Enter allows them all.
4. The answers are saved where the chosen agents' servers read them: Hermes's
   `.env` for the Hermes plugin (its `mcp.json` forwards them by name), and
   `~/.agents-automations/.env` always, for the others and the
   `agents-automations` command. A line is written only where the answer
   differs from what that server would read.
5. Then each ticked agent gets the server. Hermes installs and enables the
   plugin with its own commands. Claude Code gets `claude mcp add --scope
   user`. Claude Desktop and Cursor get an entry in their `mcpServers` file,
   with every other line kept; a file that isn't valid JSON is left alone.

`settings [--allow <list>] [--deny <list>] [--json] [--env-file <path>]`, as in
`node ~/.agents-automations/server.mjs settings`, changes only those
permissions, in every file in use: Hermes's when the plugin is installed, and
`~/.agents-automations/.env` when it exists or Hermes has no plugin. In a
terminal, with neither flag, it shows the checklist as the server reads it now;
with `--allow` or `--deny` (`web`, `write`, `bash`, `email`, `browser`,
`flow-paths`, or `all`) it asks nothing, and `--deny` wins over `--allow`. Off
a terminal it only prints the permissions, and stdout carries them as JSON.
From a clone, `agents-automations settings` does the same. `--env-file`
changes one file instead.

## Tool reference

| Tool | Input | Result |
| --- | --- | --- |
| `get_flow_schema` | none | Flow JSON Schema plus `designGuide`. |
| `get_example_flow` | none | Example flow document. |
| `validate_flow` | `flow` or `flowPath` | `ok`, `issues`, `warnings`, per-node `minimum` when valid, the ASCII `diagram`, and a `reply` line reminding the model to show the diagram and get agreement before running. |
| `render_flow` | `flow` or `flowPath`; optional `format` (`ascii`, `mermaid`, `dot`) | Text drawing. |
| `list_providers` | none | Configured providers and models. |
| `start_run` | `flow` or `flowPath`; optional `input` | The started run object, including `id` and `status: "running"`. |
| `get_run` | `runId` | Status, `outputs`, `personOutput`, `usage` (with each node's `costSource`), `costUsd`, `pricesAsOf`, `jobs` (every background job and how it ended), and `error`. |
| `get_run_events` | `runId`; optional `afterSeq`, `limit`, `reasoning` | Events with `seq >= afterSeq`; default limit 100, maximum 500. `model_call` events carry each call's tokens and cost; their reasoning text is included only with `reasoning: true`. |
| `cancel_run` | `runId` | `cancelled` boolean. A finished run cannot be cancelled. |
| `list_runs` | optional `limit` | Recent runs, newest first; default 20, maximum 100. |

Pass exactly one of `flow` or `flowPath`; supplying both is an error. `flowPath`
is accepted only when `AGENTS_AUTOMATIONS_ALLOW_FLOW_PATHS` is true.

## Authoring and approval loop

Runs are asynchronous. A safe loop is:

1. Call `get_flow_schema` and `get_example_flow` before authoring.
2. Call `validate_flow` as soon as the flow exists and after every change.
   Include its `diagram` in the reply; it names each node's model. Fix all
   issues, and treat warnings as design lint and read their repair hints.
3. Call `render_flow` only for a Mermaid or DOT drawing.
4. State the node → model mapping and the minimum tokens the flow implies.
   Explain that real use can exceed the minimum because agents loop.
5. Call `start_run` only after the user agrees.
6. Poll `get_run` until `status` is no longer `running`.
7. Paste `personOutput` in full, or the absolute path of the deliverable file.
   If the person-facing node did not run, say so; do not present a partial
   output as the answer. Then report usage, minimum, and actual `costUsd`,
   saying whether each node's cost was `billed` or at `list-price`.

To read progress without repeating events, use a cursor that advances past each
returned event. Because filtering is inclusive, request the next page with
`afterSeq` set to the last returned `seq + 1`. Persist that cursor across polls.

## Policy

Dangerous permissions are denied unless the server environment grants them:

```bash
AGENTS_AUTOMATIONS_ALLOW_BASH=false
AGENTS_AUTOMATIONS_ALLOW_WRITE=false
AGENTS_AUTOMATIONS_ALLOW_WEB=false
AGENTS_AUTOMATIONS_ALLOW_EMAIL=false
AGENTS_AUTOMATIONS_ALLOW_BROWSER=false
AGENTS_AUTOMATIONS_ALLOW_FLOW_PATHS=true

MCP_MAX_CONCURRENT_RUNS=2
MCP_MAX_FLOW_BYTES=262144
MCP_MAX_RESULT_BYTES=262144
```

These are the server's defaults when a setting is unset. `init` offers every
permission ticked instead, and writes `true` for each one you keep.

A flow that requests a denied permission fails before any provider, mailbox or
browser call. The policy belongs to the server, not to the MCP client.

The policy is not a sandbox. A granted `bash` permission allows commands with
the CLI user's reach, and a granted `browser` permission starts a browser MCP
server. Keep dangerous permissions disabled for untrusted clients.

## Resources

- `agents-automations://schema/flow`
- `agents-automations://examples/example`

## Troubleshooting

- **A dangerous permission was denied.** The policy error names the permission
  and the exact `settings` command for that server. Grant only that permission
  (`node <path to server.mjs> settings --allow web`, for example), then restart
  the server.
- **Pre-flight reports no provider key.** Set the provider's key in the env file
  or process environment. An OAuth-only Hermes session does not provide an API
  key to this server.
- **A mailbox login is rejected.** Check the app password and IMAP host; the
  pre-flight performs a real login.
- **The browser launcher fails.** Check `AGENTS_AUTOMATIONS_BROWSER_MCP_COMMAND` and the allowed
  names in `AGENTS_AUTOMATIONS_BROWSER_MCP_TOOLS`.
- **Configuration changes have no effect.** Restart the MCP client or Hermes
  session. A host may cache the server command and environment for the session.

## Architecture

```text
src/mcp/main.ts        argument parsing, context, transport, shutdown
src/mcp/server.ts      McpServer creation and explicit tool registration
src/mcp/registry.ts    the one tool list
src/mcp/tools/*.ts     one tool per file
src/mcp/run-manager.ts in-flight runs, cancellation, concurrency
src/mcp/policy.ts      permission policy
src/mcp/results.ts     result formatting and size caps
src/mcp/errors.ts      one domain-error mapping point
```

The adapter contains no graph execution logic. It calls the same `src/app`
services as the CLI.

## Not implemented

- HTTP/Streamable HTTP transport
- OAuth or bearer-token authentication
- resource subscriptions and live progress pushes
- multi-tenant session isolation

Add HTTP only when a client requires it, and keep the protocol in the official
SDK rather than growing a custom JSON-RPC layer.
