# Configuration

The installer's setup (`agents-automations init`) writes your provider key and
permissions; from a clone, `node dist/main.js init` writes the whole settings
file with safe defaults.
Read on to change a setting, move the data directory or grant a node more
tools.

## The settings file

Settings are read from `.env` in the data directory (`~/.agents-automations/.env`
by default), or from the file named by `--env-file`. A `.env` in the current
directory is never read on its own, so running the CLI inside a downloaded
project cannot pick up that project's settings. Variables already set in the
shell win over the file, so `export ANTHROPIC_API_KEY=...` works without any
file at all. The Hermes plugin reads Hermes's `.env` instead (see
[its README](../hermes-plugin/README.md#configuration)). `.env.example` in the
repository lists every setting.

```bash
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
OPENROUTER_API_KEY=

AGENTS_AUTOMATIONS_EMAIL_ADDRESS=
AGENTS_AUTOMATIONS_EMAIL_APP_PASSWORD=
AGENTS_AUTOMATIONS_EMAIL_IMAP_HOST=imap.gmail.com
AGENTS_AUTOMATIONS_EMAIL_IMAP_PORT=993

AGENTS_AUTOMATIONS_BROWSER_MCP_COMMAND="npx -y chrome-devtools-mcp@1.10.1 --headless --isolated"
AGENTS_AUTOMATIONS_BROWSER_MCP_TOOLS=new_page,navigate_page,take_snapshot,evaluate_script,list_pages,wait_for,click,type_text,press_key
```

A provider is usable once its key is set. The MCP tool `list_providers` (or
`agents-automations providers` from a clone) lists the ones that are. Mail is read over IMAP with an app password (Google offers one
only once 2-Step Verification is on); leave the two `AGENTS_AUTOMATIONS_EMAIL_` values empty and
agents simply get no email tools.

The default browser launcher is pinned to an exact `chrome-devtools-mcp`
version, so a new release never runs before someone has looked at it. To
upgrade, check the package's release notes, then set `AGENTS_AUTOMATIONS_BROWSER_MCP_COMMAND` to
the new version (or change `DEFAULT_BROWSER_MCP_COMMAND` in
`src/config/runtime-config.ts`, `.env.example` and the READMEs together).

Provider requests always go to the provider's official address: the CLI ignores
`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `LANGSMITH_GATEWAY` and similar
variables. LangChain/LangSmith tracing (`LANGSMITH_TRACING`,
`LANGCHAIN_TRACING_V2`, ...) is switched off unless you also set
`AGENTS_AUTOMATIONS_LANGSMITH_TRACING=true`, because a trace uploads every prompt,
tool result and email excerpt. A value that is still an unexpanded `${VAR}`
placeholder counts as unset.

## Run guardrails

| Environment variable | Guard | Default |
| --- | --- | --- |
| `MAX_NODE_ITERATIONS` | Model calls per node, unless the node sets `maxIterations` | 25 |
| `MAX_RUN_STEPS` | Steps per run | 200 |
| `MAX_PARALLEL_NODES` | Concurrent nodes | 4 |
| `RUN_TIMEOUT_MS` | Wall clock per run | 1,800,000 ms (30 min) |
| `BASH_TIMEOUT_MS` | How long a shell command runs when it does not ask for longer | 120,000 ms (2 min) |
| `BASH_TIMEOUT_MAX_MS` | Most a shell command may ask for with `timeoutSeconds` (never less than `BASH_TIMEOUT_MS`) | 600,000 ms (10 min) |
| `JOB_TIMEOUT_MS` | Longest a background job may run | 1,800,000 ms (30 min) |
| `MODEL_CALL_TIMEOUT_MS` | Longest one model call may take; it is retried once, then the node fails | 300,000 ms (5 min) |
| `BASH_OUTPUT_LIMIT_BYTES` | Most one tool result returns to the model, for every tool | 32,768 bytes (32 KiB) |
| `TOOL_OUTPUT_SAVE_LIMIT_BYTES` | Most an oversized result saved to the workspace holds | 1,048,576 bytes (1 MiB) |
| `TOOL_OUTPUT_STEP_LIMIT_BYTES` | Most all tool results of one model response return together | 131,072 bytes (128 KiB) |
| `WEB_FETCH_TIMEOUT_MS` | Web fetch timeout | 20,000 ms |
| `WEB_FETCH_LIMIT_BYTES` | Web download cap | 262,144 bytes |
| `AGENTS_AUTOMATIONS_EMAIL_TIMEOUT_MS` | Mailbox operation timeout | 20,000 ms |
| `AGENTS_AUTOMATIONS_BROWSER_MCP_TIMEOUT_MS` | Browser handshake or tool-call timeout | 120,000 ms |

### Long tool results

No tool result returns more than `BASH_OUTPUT_LIMIT_BYTES` to the model, because
everything a node reads is re-sent on each of its later iterations. Nothing past
the cap is lost, though:

- `read_file` takes optional `offset` and `length` in bytes. A file longer than
  the cap comes back one piece at a time, and each piece starts with a note
  such as `[notes.txt: bytes 0-32760 of 91544; continue with offset=32760]`.
  Pieces end on a line break where possible and never split a character.
- A `run_bash`, `web_fetch`, browser or email result over the cap returns its
  first piece, and the whole result, up to `TOOL_OUTPUT_SAVE_LIMIT_BYTES`, is
  saved to `.tool-output/<node>-<tool>-<n>.txt` in the run workspace. The note
  names the file and the `read_file` offset to continue from, or a `tail -c`
  command for a node with `bash` but not `read`. A node with neither gets no
  file, only a note saying how much was cut. The note comes first, so the model
  knows before it reads that it has only part. A `run_bash` result shows its
  first 40% and its last 60%, with `[…]` between, and the end is the true end
  of the output even when it ran past the save limit. `email_get_message`
  shows the first 4 KiB of a message.
- When one model response calls several tools, their results together return
  at most `TOOL_OUTPUT_STEP_LIMIT_BYTES`; a result past that is cut, with a
  note, and keeps at least 1 KiB so its own note survives.
- The tool descriptions state both numbers, so a model knows the budget before
  it calls.

### Running out of model calls

Every step tells a node how many model calls it has left, counting whichever
limit is closer: its own (`MAX_NODE_ITERATIONS`, or its `maxIterations`) or
what remains of the run's `MAX_RUN_STEPS`. From three calls left it is told to
wrap up, and its last call offers only `complete_task`. A node that ends this
way hands over what it has instead of failing the run: the result lists it in
`stoppedEarlyNodes`, its `node_completed` event says `stoppedEarly`, and each
successor sees its handoff marked as partial. A node that must choose a branch
and does not, or whose last output fails its `outputSchema`, still fails,
because no call is left to correct it.

### Time limits: thinking and waiting are counted apart

Model calls cost money, so they are limited by count (`MAX_NODE_ITERATIONS`,
`MAX_RUN_STEPS`). Waiting costs nothing, so it is limited by time, and a node
never has to spend model calls to wait:

- A `run_bash` command is killed after `BASH_TIMEOUT_MS` (2 minutes), so a hung
  command is caught quickly. A command that needs longer passes
  `timeoutSeconds`, up to `BASH_TIMEOUT_MAX_MS` (10 minutes).
- Anything longer runs as a background job (below), with its own
  `JOB_TIMEOUT_MS` deadline (30 minutes, or less when the job asks for less),
  and `wait_job` waits for it in a single model call however long it takes.
- One model call that does not answer within `MODEL_CALL_TIMEOUT_MS` (5
  minutes) is retried once; a second timeout fails the node and says so,
  instead of a hung provider holding the run until its time limit.
- `RUN_TIMEOUT_MS` (30 minutes) is the hard ceiling over all of it, waiting
  included. When it is hit, the run stops every job and names those that were
  still running.
- When a node holds running jobs, or the run has less than 10 minutes left,
  every step note shows the clock too:
  `[18 of 25 model calls left · jobs: job-1 running 4m12s · run time left 21m]`.
  `wait_job` stops at the run's time limit and says so.

### Background jobs

A node with `bash` can run a command in the background with
`run_bash` `background: true`. It returns at once with a job id such as
`job-1`, and the command's output goes to `.jobs/job-1.log` in the workspace.
Three tools work on jobs:

| Tool | What it does |
| --- | --- |
| `job_status` | How each job stands, with the end of its log. Returns at once. |
| `wait_job` | Waits until the jobs end, `seconds` pass, a job's deadline arrives or the run's time runs out, then reports each one with the end of its log. One model call. |
| `stop_job` | Kills a job with everything it started. |

Jobs belong to the run, not to the node that started them:

- A job still running when its node calls `complete_task` is handed to the
  nodes after it, along each edge that was taken, the way a handoff is. Each of
  them starts with a `# Background jobs handed to you` section, written by the
  runtime from the job's live record, and holds the job: any node that received
  it can check on it, wait for it or stop it.
- A node with `"waitForJobs": true` does not start until every job handed to
  it has ended. That wait costs no model calls, and the node starts with each
  job's final status and the end of its log. It is off by default.
- A node that finishes with jobs running is not partial; its `node_completed`
  event lists the jobs it handed on. A node that runs out of model calls is
  still partial, but its jobs are handed on intact, and its wrap-up note tells
  it to say what each is for.
- When the run ends, fails or is cancelled, every job still running is
  stopped. The result's `jobs` field (and `get_run` in MCP) records every job:
  its command, the node that started it, its status (`exited`, `stopped`,
  `timed out`), exit code, times and log path. `job_started` and `job_ended`
  events mark each one, and `jobs_waited` marks a `waitForJobs` wait.
- A process that an ordinary command leaves running (`cmd &`, `nohup`) is taken
  on as a job too, so it is tracked, handed on and stopped like the rest. Its
  output was not captured, so prefer `background: true`. A process started
  with `setsid` leaves the command's process group and cannot be tracked.

### What a run records about each model call

Each model call writes a `model_call` event: its place in the node's budget
(`step`), its input, output, cache and reasoning tokens, its cost when priced,
and the model's reasoning text when the provider returns it (capped at 8,000
characters). On OpenRouter the reasoning is also sent back with the earlier
messages on every later call, as OpenRouter asks for during tool use and
DeepSeek requires.

## Run artifacts

By default:

```text
~/.agents-automations/
  .env
  runs/<runId>/meta.json
  runs/<runId>/events.jsonl
  workspaces/<runId>/
```

`--data-dir`, `DATA_DIR` or `AGENTS_AUTOMATIONS_HOME` override the root. The data
directory and everything the CLI writes in it are owner-only (`0700` folders,
`0600` files), because run records hold inputs, outputs, tool calls, model reasoning and email
excerpts. `--no-save` keeps the workspace but writes neither `meta.json` nor
`events.jsonl`. A pure CLI process never marks another process's in-flight run
as failed, so concurrent invocations are safe.

Each run gets a fresh, empty workspace shared by every node in that run.
`read_file` and `write_file` are confined to it, including through `..` and
symlinks. `run_bash` is not a sandbox: a node holding `bash` can run any command
the CLI user can. Child processes get an allowlist environment — `PATH`, locale,
`TERM`, `TZ` and `DISPLAY`, plus any names listed in `AGENT_ENV_PASSTHROUGH` —
so provider keys and the mailbox password are never forwarded. `HOME` and temp
directories point inside the run's workspace, or, for browser MCP servers, a
private home at `<data dir>/mcp-home` that must be owner-only.

There is no `--workspace` option for mounting an existing directory. File
content can enter through run input, tool results, or files created during the
run.

## Permissions

Permissions are per node, and a node gets only the tools its permissions name:

| Permission | Tools |
| --- | --- |
| `read` | `read_file` |
| `write` | `write_file` |
| `bash` | `run_bash` |
| `web` | `web_fetch` |
| `email_read` | `email_search`, `email_get_message` |
| `browser` | tools from the browser MCP server |

`email_read` needs a mailbox credential. `browser` needs a working
`AGENTS_AUTOMATIONS_BROWSER_MCP_COMMAND`; a node gets its own browser server, and only tools in
`AGENTS_AUTOMATIONS_BROWSER_MCP_TOOLS` are exposed to the model. What each permission really
allows is in [`SECURITY.md`](../SECURITY.md).
