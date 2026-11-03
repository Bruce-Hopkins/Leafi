# agents-automations

Run precise, efficient, multi-step automations made of LLM agents linked together. Let your agent create a saved flow for you, and let your agent use it reliably whenever needed.

This is a prototype, but new updates are coming soon. Star the project to receive updates on the progress!

## Install

To install on Hermes, Claude Code, or Cursor, you need Node.js 22 or newer. On macOS, Linux or WSL2:

```bash
curl -fsSL https://raw.githubusercontent.com/Bruce-Hopkins/agent-automations/main/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/Bruce-Hopkins/agent-automations/main/install.ps1 | iex
```

You can ask any agent to use the project:

> Use agents-automations to find this month's most-cited arXiv papers on small code
> models and brief me on them in a few paragraphs. You may use web, not bash.

### Install Manually

With Hermes, on macOS and Linux:

```bash
hermes plugins install Bruce-Hopkins/agent-automations/hermes-plugin --enable
node ~/.hermes/plugins/agents-automations/dist/server.mjs init
```

On Windows, in PowerShell:

```powershell
hermes plugins install Bruce-Hopkins/agent-automations/hermes-plugin --enable
node "$env:LOCALAPPDATA\hermes\plugins\agents-automations\dist\server.mjs" init
```

For another MCP client, download the server (a single file) and run its setup:

```bash
mkdir -p -m 700 ~/.agents-automations
curl -fsSL -o ~/.agents-automations/server.mjs https://raw.githubusercontent.com/Bruce-Hopkins/agent-automations/main/hermes-plugin/dist/server.mjs
node ~/.agents-automations/server.mjs init
```

`init` is the installer's setup, with the same checklist. It ends by printing
the entry to paste into your client's `mcpServers`. To fill in the settings by
hand instead, copy from [`.env.example`](.env.example).

### Changing permissions later

`bash`, `email` and `browser` start off. When a flow needs one, you're asked
before it runs, and can allow it once or always. To change them yourself, run
the server with `settings`, then restart Hermes or your client. It changes the
permissions for every agent you installed into:

```bash
agents-automations settings
```

If you installed by hand, run `node <server> settings` instead, where the
server is `~/.agents-automations/server.mjs`, or
`~/.hermes/plugins/agents-automations/dist/server.mjs` for the Hermes plugin.

[`hermes-plugin/README.md`](hermes-plugin/README.md) covers updating the plugin
and what happens during a run.

## Security

A node with `bash` can run any command you can, and a `browser` node can reach
your local network: neither is sandboxed. Text from web pages and emails can
steer an agent, so a node that reads untrusted content should not also hold
`bash` or `write`. Read [`SECURITY.md`](SECURITY.md) before running a flow you
did not write; it also explains how to report a vulnerability.


## Development

To work from source, you also need pnpm:

```bash
git clone https://github.com/Bruce-Hopkins/agent-automations.git
cd agent-automations
pnpm install
pnpm build
node dist/main.js --help     # or: pnpm cli --help, which builds first
pnpm build:plugin            # bundles the CLI and the server into hermes-plugin/dist/server.mjs
pnpm add -g "link:$PWD"      # optional: put this checkout on your PATH
```

`pnpm cli` and `pnpm dev` read the same settings as the installed CLI,
`~/.agents-automations/.env`. The checks:

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm test:plugin   # builds and exercises the bundled Hermes server
pnpm test:pack     # packs the npm tarball, installs it and runs every command
```

Hermes doesn't build the plugin when it installs it, so after changing the
server, run `pnpm build:plugin` and commit `hermes-plugin/dist/`. Before a
release, `hermes plugins validate ./hermes-plugin --json` must pass.
