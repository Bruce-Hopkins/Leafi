# leafi

Run precise, efficient, multi-step automations made of LLM agents linked together. Let your agent create a saved flow for you, and let your agent use it reliably whenever needed.

This is a prototype, but new updates are coming soon. Star the project to receive updates on the progress!

## Install

To install on Hermes, Claude Code, or Cursor, you need Node.js 22 or newer. On macOS, Linux or WSL2:

```bash
curl -fsSL https://raw.githubusercontent.com/Bruce-Hopkins/leafi/main/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/Bruce-Hopkins/leafi/main/install.ps1 | iex
```

### Install on Pi

[Pi](https://pi.dev) installs leafi as an extension package, not through the installer above:

```bash
pi install npm:pi-leafi
node ~/.pi/agent/npm/node_modules/pi-leafi/dist/server.mjs init   # in a normal terminal, not inside Pi
```

### Install Manually

With Hermes, on macOS and Linux:

```bash
hermes plugins install Bruce-Hopkins/leafi/hermes-plugin --enable
node ~/.hermes/plugins/leafi/dist/server.mjs init
```

On Windows, in PowerShell:

```powershell
hermes plugins install Bruce-Hopkins/leafi/hermes-plugin --enable
node "$env:LOCALAPPDATA\hermes\plugins\leafi\dist\server.mjs" init
```

For another MCP client, download the server (a single file) and run its setup:

```bash
mkdir -p -m 700 ~/.leafi
curl -fsSL -o ~/.leafi/server.mjs https://raw.githubusercontent.com/Bruce-Hopkins/leafi/main/hermes-plugin/dist/server.mjs
node ~/.leafi/server.mjs init
```

`init` is the installer's setup, with the same checklist. It ends by printing
the entry to paste into your client's `mcpServers`. To fill in the settings by
hand instead, copy from [`.env.example`](.env.example).

## How to use

Your agent should already know how to use it. If you ask it to build an automation, it will design the flow, ask you about what it built, and ask for permission to run it. For an example prompt, ask this:

> Use leafi to find this month's most-cited arXiv papers on small code models and brief me on them in a few paragraphs. You may use web, not bash.

You can also change the settings by running:

```bash
leafi settings
```

If you installed by hand, run `node <server> settings` instead, where the
server is `~/.leafi/server.mjs`, or
`~/.hermes/plugins/leafi/dist/server.mjs` for the Hermes plugin.

