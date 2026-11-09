# pi-leafi

Lets [Pi](https://pi.dev) design, validate, draw and run [leafi](https://github.com/Bruce-Hopkins/leafi)
flows: automations made of linked LLM agents. It adds 13 tools (all named
`leafi_*`), a `/leafi` command and a skill that teaches the model how to design a
cheap flow. It has no runtime dependencies; the leafi server is bundled in
`dist/server.mjs`, so the only requirement is Node.js 22 or newer.

## Install

```bash
pi install npm:pi-leafi
```

Then give leafi a provider key and choose which tools flows may use. Run this in a
normal terminal, not inside Pi, because it needs a terminal that Pi's interface
holds while it runs:

```bash
node ~/.pi/agent/npm/node_modules/pi-leafi/dist/server.mjs init
```

If you already use the leafi CLI or the Hermes installer, `~/.leafi/.env` already
has your settings and there is nothing to do. Start Pi and ask:

> Use leafi to find this month's most-cited arXiv papers on small code models
> and brief me on them in a few paragraphs. You may use web, not bash.

To try it from a clone without installing:
`pnpm build:pi && pi -e ./pi-extension/dist/index.js`.

## How it works

The extension is a thin bridge. The first leafi tool call starts the leafi server
as a child process of Pi and talks to it over stdio; nothing runs while Pi is
loading or until you use a tool. The server is the same one the Hermes plugin
uses, so flows, saved flows and run history live in `~/.leafi`, shared with the
`leafi` command.

It is deliberately not loaded into Pi's own process: leafi reads `~/.leafi/.env`
into its environment, and that must not become Pi's.

| Tool | Does |
| --- | --- |
| `leafi_get_flow_schema`, `leafi_get_example_flow` | The flow format and the design guide |
| `leafi_validate_flow`, `leafi_render_flow` | Free checks and drawings |
| `leafi_list_providers` | Which provider keys are set |
| `leafi_start_run` | Starts a flow, after the permission check below |
| `leafi_wait_run` | Waits for a run inside the extension, with progress, at no model cost. Esc stops the wait, not the run |
| `leafi_get_run`, `leafi_get_run_events`, `leafi_list_runs`, `leafi_cancel_run` | Inspect and cancel runs |
| `leafi_list_flows`, `leafi_get_flow` | Saved flows |

`/leafi runs` lists recent runs, `/leafi cancel <id>` cancels one, `/leafi status`
shows whether the server is running and which providers are set, and
`/leafi settings` shows the permissions and the command that changes them.

## Security

**Pi packages run with your full system permissions, and so does leafi.** It runs
LLM agents on your machine, as you; it is not a sandbox. A flow node with `bash`
can run any command you can. Read [SECURITY.md](https://github.com/Bruce-Hopkins/leafi/blob/main/SECURITY.md)
before you allow `bash`, `email` or `mcp`.

- Permissions that are turned off stay off. When `leafi_start_run` gets a flow that
  needs one, **you** are asked in a dialog (*Allow this run*, *Always allow* or
  *Deny*). The model cannot answer it, so text a flow reads cannot grant itself a
  permission. *Always allow* is saved to `~/.leafi/.env`.
- Without a UI (`pi -p`, JSON mode), or if you press Esc, the answer is no, and the
  error names the command that would allow it.
- The server gets only an allowlisted environment: `PATH`, `HOME`, locale, the four
  provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`,
  `OPENROUTER_API_KEY`) and `LEAFI_*`. Nothing else in Pi's environment is passed on.

## Runs end with the session

`/new`, `/reload`, `/resume`, `/fork` and quitting Pi stop the leafi server, and a run that is
still going is **cancelled** and stored as cancelled. Pi requires that nothing keeps
running after a session ends, so a run cannot carry on in the background. Wait for
`leafi_wait_run` to finish before you start a new session, or run long flows with the
`leafi` command instead.

After you change permissions with `settings`, run `/new` so the server restarts and
reads them.

## Build

```bash
pnpm build:pi     # bundles pi-extension/dist and generates skills/leafi/SKILL.md
pnpm test:pi      # builds, then runs test/pi-extension.test.ts
```

`skills/leafi/SKILL.md` is generated from the Hermes skill with the tool names
renamed; edit `hermes-plugin/skills/leafi/SKILL.md`, not the copy.
