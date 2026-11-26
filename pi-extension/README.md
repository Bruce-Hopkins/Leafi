# pi-leafi

Lets [Pi](https://pi.dev) design, validate, draw and run [leafi](https://github.com/Bruce-Hopkins/leafi)
flows: automations made of linked LLM agents. Each automation is saved and can be run again.

Build automations that you can optimize and improve, so the linked agents run consistently every time. Each time you run an automation and refine it with Pi, the next run is better.

Pi will talk you through the automation it has created and the models it uses, and give you feedback on the token usage and cost.

## Quick start

To install it and set your preferred provider, run these in a normal terminal, not inside Pi:

```bash
pi install npm:pi-leafi
node ~/.pi/agent/npm/node_modules/pi-leafi/dist/server.mjs init
```

Then you can ask Pi to create an automation for you. Ask it to use leafi to build it.

## Settings

Settings live in `~/.leafi/.env`, shared with the `leafi` command and the Hermes
plugin. Already use either? Skip `init`.

| Tool | Lets agents | Default |
| --- | --- | --- |
| `web` | fetch web pages | on |
| `write` | write files in the run's own folder | on |
| `bash` | run any shell command you could run | off |
| `email` | read your mailbox, read-only (needs a mailbox login in `~/.leafi/.env`) | off |
| `mcp` | use an MCP server's tools (headless Chrome by default) | off |

