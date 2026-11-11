/**
 * The design rules a flow author needs, returned alongside the schema by
 * `get_flow_schema`. An MCP client that only reads tool results — Hermes, for
 * instance — never sees the repository documentation, so the guide has to
 * travel with the call the author already makes.
 *
 * Kept in sync by hand with agents/HOW_TO_DESIGN_YOUR_FLOW.md, the node-splitting
 * table in AGENTS.md and the rule list in src/domain/flow-lint.ts. Every lint
 * code named below is one `validate_flow` reports.
 */
export const DESIGN_GUIDE = `# Designing a flow

## Delivery

Every time you hand over or change a flow, show the user its diagram: the
"diagram" field validate_flow returns, or render_flow for Mermaid or DOT. The
diagram names each node's model, so it is also the node-to-model mapping. Before
start_run, state that mapping and the minimum tokens the flow implies, and run
only with the user's agreement. A flow the user never saw is a flow the user
cannot correct. start_run saves the flow by name: call list_flows before
designing one the user may already have.

A flow is { name, nodes, edges }. Entry nodes (no incoming edges) run when the
run starts and receive --input; a terminal node has no outgoing edges and ends
the run. An edge carries the producer's complete_task output and nothing else,
so that text is the whole interface between two nodes.

## Start from one node, then split only for a reason

A node is a context boundary, not a step. Steps that share a model tier,
permissions and context belong in one node, however many verbs the request has
("get news, get weather" is one node with two run_bash calls). Split only when
one of these is true:

- tier — the work genuinely needs a model the rest do not; a weak model is the default, so a strong one is an exception you must justify.
- permissions — a trust boundary; the node reading untrusted input must not hold bash.
- isolation — a node reads a lot and emits a little, and the bulk must not reach the node that reasons over it.
- branch — a real decision with a numeric predicate.
- parallel — independent sources that should not wait for each other.

Do NOT give one node per step of a for-loop-shaped task: one node processing all
the items costs less than N nodes processing one each.

Answer these before finishing, and before running:

1. Is any context repeated between nodes? If so, reconsider the split.
2. Does the last node receive enough to write the answer the user asked for?
3. Is this spending more tokens than one strong node would?
4. Is each node here because it is the best design, or because it is one step in
   the sentence the user wrote?

## Shapes that work

Sources side by side, one consumer. Independent sources get no edges between
them: each is an entry node, and the consumer names them in inputs.

    [ mail ]    --\\
    [ weather ] --+-->  [ synthesise ]  -->  the person
    [ news ]    --/

The sources run at once and the consumer sees each handoff directly — no file
round trip and no edge that exists only to order execution.

Read a lot, emit a little. Bulk reading happens on a weak model; the consumer
receives a short result, never the raw material. The expensive context is the
thing to avoid, not a reward for getting through the cheap nodes.

Mechanical / judgement split. Fetch-and-format is mechanical; ranking, judging
and writing need judgement but not necessarily a stronger model. Split when the
writer should not carry the raw material, and keep the writer on the weak model
unless you can name what it gets wrong.

## Wiring

- inputs: ["<node id>", ...] replaces the default (each direct predecessor's
  handoff) and may name any ancestor, so the end of a chain can read its start
  without a file round trip. "inputs": [] means ordering only — the edge runs and
  carries no text. Include "$input" to give a non-entry node the run input.
  A declared source that did not run on the path is marked and skipped.
- A node with several incoming edges waits for all of them and runs once if at
  least one edge was taken.
- fanout: "branch" (the default) picks one edge by branch name and condition;
  fanout: "parallel" takes every outgoing edge, up to MAX_PARALLEL_NODES at once.
- Add a branch only for a real decision decided by a numeric predicate.
- Recursion: an edge may carry maxTraversals (an edge limit), the number of times
  it may be taken in a run. Its purpose is to prevent runaway recursion: a cycle,
  or a node looping into itself, is valid only when an edge in it has one. Once
  used up, the source is forced down another edge, so the node needs an unlimited
  exit edge (no-exit-edge). The loop's nodes run again, seeing their previous
  output and pass number; the minimum's maxPasses shows the worst case. Keep the
  limit low (1 to 3) and the exit decided by a numeric predicate.
- Nodes that may run at once share one workspace, so give each its own output
  path.

## Cost and precision

- Default every node to a weak model, and escalate one only when you can name
  what the weak model gets wrong there. Looping is the cost driver: a weak model
  is cheaper per token, but repeated iterations can erase that advantage, so
  judge a flow on its actual costUsd and output quality, not model tier alone.
- Keep raw JSON out of the context: for a JSON API prefer run_bash with
  curl -s <url> | jq '<filter>' over web_fetch, and project only the fields the
  node needs. Every tool result is re-sent on each later iteration.
- Batch tool calls: every tool call in one model response runs before the next
  iteration, so ask for all N reads in a single turn.
- Size batches to the cap: a tool result over 32 KiB is cut (the rest is saved
  to a file), and one response's results together return at most 128 KiB. A
  prompt that asks for 30 rows at a time when 30 rows are 26 KB is fine; one
  that asks for 100 is not.
- A node gets 25 model calls by default; it is told how many are left, and one
  that runs out hands over a partial result. Give the one node whose work needs
  more its own "maxIterations" rather than hoping it finishes in time.
- Never spend model calls waiting. A shell command runs up to 2 minutes (10 if
  it passes timeoutSeconds). For anything longer, tell the node to use run_bash
  with background: true and then wait_job, which waits in one call; never
  sleep loops or nohup. A job still running at complete_task is handed to the
  next node, and "waitForJobs": true makes that node wait for it before it
  starts, at no model cost.
- Write a run's files inside its workspace, not a shared folder like /tmp: a
  file left there by an earlier run looks just like this run's.
- Push bulk through the workspace — hand a downstream node a file path, not the
  content — and never fetch the same source in two nodes.
- Name the exact endpoint, query and fields. State the exact output path and
  shape. Say what to do when data is missing ("note it; never invent").
- Grant the minimum permissions per node: read, write, bash, web, email_read,
  mcp (by default a headless Chrome through chrome-devtools-mcp).
- outputSchema (minLines, maxLines, linePattern, linePatternHint, mustContain,
  mustNotContain) enforces a handoff a machine consumes; on a mismatch the output
  is rejected back to the node for up to three attempts.

## The node a person reads

Mark the one terminal node a person reads with "audience": "person". Its
producers hand over notes carrying the specifics a reader would act on — names,
amounts, dates, claims — not rows formatted for a machine. Write prose for a
stated reader in a stated register, and impose no template, linePattern or
minLines/maxLines on it: that is what rigid-deliverable warns about.

## Lint warnings validate_flow reports

- json-via-web-fetch — a JSON API fetched with web_fetch; use curl | jq.
- no-exact-endpoint — a node that can fetch but names no URL.
- qualitative-branch — branching on a vibe instead of a numeric predicate.
- downstream-reads-input — a non-entry node expecting the run input.
- rigid-deliverable — a template or a line check on a person-facing node.
- concurrent-write — two nodes that may run at once writing the same path.
- parallel-limit-one — MAX_PARALLEL_NODES is 1 and two nodes can be ready at
  once; such a run loses outputs. Ask the user to raise the setting.

Fix the cause, not the wording. Warnings are the difference between a flow that
beats a lone agent and one that loses to it; opt a node out only when the lint is
wrong for it, with "lintIgnore": ["<code>"].

## Before running

validate_flow is free and makes no model calls. It also returns a per-node
minimum: the tokens the flow implies, and a lower bound rather than a forecast.
Agents loop, and every iteration re-sends the context so far, so a real run
spends more, by an amount that varies with looping and model behavior rather
than following a fixed multiplier. Pass the caveat on whenever you report it to
the user. Dollars come after the run: costUsd is priced from what each call
actually used, and each node's costSource says whether it is what the provider
billed ("billed", OpenRouter) or tokens at list price ("list-price", as of
pricesAsOf). Show the
diagram it returns, as described under Delivery, before you run anything.`;
