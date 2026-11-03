/**
 * The settings file `agents-automations init` writes. Keep it in step with
 * `.env.example`; a test checks both name the same variables.
 */
export const ENV_TEMPLATE = `# Written by "agents-automations init". Settings for every agents-automations command.
# Variables already set in the shell take precedence over this file.

# Provider keys: set at least one. A node can only use a model whose provider
# has a key. In Hermes, an OAuth or subscription login is not a key: the plugin
# needs one of these.
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
OPENROUTER_API_KEY=

# Permissions: the tools a flow started over MCP (from Hermes, Claude Desktop,
# Cursor ...) may use. Flows run with \`agents-automations run\` are not limited by
# these. \`agents-automations settings\` changes them for you; a line left out keeps the
# value shown.
#   web         web_fetch
#   write       write_file, inside the run workspace
#   bash        run_bash: any command you can run
#   email       the read-only mailbox tools (needs the mailbox below)
#   browser     a headless Chrome (the launcher below)
#   flow-paths  passing a flow as a file path instead of inline JSON
# AGENTS_AUTOMATIONS_ALLOW_WEB=false
# AGENTS_AUTOMATIONS_ALLOW_WRITE=false
# AGENTS_AUTOMATIONS_ALLOW_BASH=false
# AGENTS_AUTOMATIONS_ALLOW_EMAIL=false
# AGENTS_AUTOMATIONS_ALLOW_BROWSER=false
# AGENTS_AUTOMATIONS_ALLOW_FLOW_PATHS=true

# Mailbox, for email nodes: read-only, over IMAP, with an app password. Gmail
# offers one once 2-Step Verification is on; the account password never works.
# With the address or password empty, agents get no email tools.
AGENTS_AUTOMATIONS_EMAIL_ADDRESS=
AGENTS_AUTOMATIONS_EMAIL_APP_PASSWORD=
AGENTS_AUTOMATIONS_EMAIL_IMAP_HOST=imap.gmail.com
AGENTS_AUTOMATIONS_EMAIL_IMAP_PORT=993
# AGENTS_AUTOMATIONS_EMAIL_TIMEOUT_MS=20000

# Browser nodes start this launcher and may call only the tools listed. It is
# pinned to an exact version: upgrade it on purpose, after reading its notes.
# AGENTS_AUTOMATIONS_BROWSER_MCP_COMMAND=npx -y chrome-devtools-mcp@1.10.1 --headless --isolated
# AGENTS_AUTOMATIONS_BROWSER_MCP_TOOLS=new_page,navigate_page,take_snapshot,evaluate_script,list_pages,wait_for,click,type_text,press_key
# AGENTS_AUTOMATIONS_BROWSER_MCP_TIMEOUT_MS=120000

# ---- Everything below is for ~/.agents-automations/.env only; Hermes ignores it. ----

# Extra environment variables to forward to \`run_bash\` and browser MCP servers.
# Everything else is filtered out, so list only names a tool genuinely needs.
# AGENT_ENV_PASSTHROUGH=HTTP_PROXY,HTTPS_PROXY

# Run guardrails.
MAX_NODE_ITERATIONS=25
MAX_RUN_STEPS=200
MAX_PARALLEL_NODES=4
RUN_TIMEOUT_MS=1800000
# How long a shell command runs (2 minutes by default); a node may ask for up
# to BASH_TIMEOUT_MAX_MS (10 minutes) with timeoutSeconds.
# BASH_TIMEOUT_MS=120000
# BASH_TIMEOUT_MAX_MS=600000
# The longest a background job (run_bash with background: true) may run.
# JOB_TIMEOUT_MS=1800000
# How long one model call may take; it is retried once, then the node fails.
# MODEL_CALL_TIMEOUT_MS=300000
# The most one tool result returns to the model (32 KiB by default).
# BASH_OUTPUT_LIMIT_BYTES=32768
# A result over that cap is saved to the workspace, up to this many bytes, and
# the node reads on from the file in pieces.
# TOOL_OUTPUT_SAVE_LIMIT_BYTES=1048576
# The most all tool results of one model response return together.
# TOOL_OUTPUT_STEP_LIMIT_BYTES=131072
WEB_FETCH_TIMEOUT_MS=20000
WEB_FETCH_LIMIT_BYTES=262144

# LangChain/LangSmith tracing uploads every prompt and tool result, so its
# variables (LANGSMITH_TRACING, ...) are ignored unless this is true.
# AGENTS_AUTOMATIONS_LANGSMITH_TRACING=false

# Runtime state. Defaults to ~/.agents-automations.
# AGENTS_AUTOMATIONS_HOME=
# DATA_DIR=

# Limits for agents-automations-mcp.
# MCP_MAX_CONCURRENT_RUNS=2
# MCP_MAX_FLOW_BYTES=262144
# MCP_MAX_RESULT_BYTES=262144
`;
