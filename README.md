# agents-automations

Run precise, efficient automation made of LLM agents linked together. Let your agent create a saved flow for you, and let your agent use it reliably whenever needed.

This is a prototype, but new updates are coming soon. Star the project to receive updates on the progress!

## Install

To install on Hermes, Claude Code, Claude Desktop or Cursor, you need Node.js 22 or newer. On macOS, Linux or WSL2:

```bash
curl -fsSL https://raw.githubusercontent.com/Bruce-Hopkins/agents-automations/main/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/Bruce-Hopkins/agents-automations/main/install.ps1 | iex
```

It shows a checklist of the agents it finds (Hermes, Claude Code, Claude
Desktop, Cursor) and installs only into the ones you tick. Then it asks for a
provider API key and which permissions flows may use.

It also adds an `agents-automations` command, so you can check and run flows
yourself. On macOS, Linux and WSL2 it goes in `~/.local/bin`, and if that folder
is not on your PATH the installer prints the line that adds it. On Windows it
goes in `~\.agents-automations\bin`, which the installer adds to your PATH.

```bash
agents-automations schema example > flow.json   # an example two-node flow
agents-automations graph --graph flow.json      # draw it, with each node's model
agents-automations validate --graph flow.json   # check it; free, no model calls
agents-automations run --graph flow.json --input "Review this plan"
```

The example uses one OpenAI model and one Anthropic model. Before running it,
change each node's `model` to one your key covers: `agents-automations providers`
lists the models for the keys you have set.

Then ask your agent for the outcome rather than the flow:

> Use agents-automations to find this month's most-cited arXiv papers on small code
> models and brief me on them in a few paragraphs. You may use web, not bash.

### Install Manually

With Hermes:

```bash
hermes plugins install Bruce-Hopkins/agents-automations/hermes-plugin --enable
node ~/.hermes/plugins/agents-automations/dist/server.mjs init
```

On Windows, the second line is
`node "$env:LOCALAPPDATA\hermes\plugins\agents-automations\dist\server.mjs" init`.
Installing the plugin this way does not add the `agents-automations` command.

For another MCP client, download the server (a single file), link the
`agents-automations` command to it, and set it up:

```bash
mkdir -p -m 700 ~/.agents-automations
curl -fsSL -o ~/.agents-automations/server.mjs \
  https://raw.githubusercontent.com/Bruce-Hopkins/agents-automations/main/hermes-plugin/dist/server.mjs
chmod +x ~/.agents-automations/server.mjs
mkdir -p ~/.local/bin
ln -sf ~/.agents-automations/server.mjs ~/.local/bin/agents-automations
agents-automations init
```

If `~/.local/bin` is not on your PATH, add `export PATH="$HOME/.local/bin:$PATH"`
to your shell's profile, or use `node ~/.agents-automations/server.mjs` wherever
this README says `agents-automations`.

`init` is the installer's setup, with the same checklist. It ends by printing
the entry for any other MCP client. To fill in the settings by hand instead,
copy from [`.env.example`](.env.example).

### Changing permissions later

Run `settings`, then restart Hermes or your client. It changes the permissions
for every agent you installed into:

```bash
agents-automations settings
```

If you installed only the Hermes plugin by hand, run
`node ~/.hermes/plugins/agents-automations/dist/server.mjs settings` instead.

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
git clone https://github.com/Bruce-Hopkins/agents-automations.git
cd agents-automations
pnpm install
pnpm build
node dist/main.js --help     # or: pnpm cli --help, which builds first
pnpm build:plugin            # bundles the CLI and the server into hermes-plugin/dist/server.mjs
pnpm add -g "link:$PWD"      # optional: put this checkout on your PATH in place of the installed command
```

`pnpm cli` and `pnpm dev` read the same settings as the installed command,
`~/.agents-automations/.env`. From a clone, `node dist/main.js init --yes` writes
that file and a starter `flow.json` instead of running the installer's setup.
The checks:

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm test:plugin   # builds and exercises the bundled Hermes server
pnpm test:pack     # packs the npm tarball, installs it and runs every command
```



