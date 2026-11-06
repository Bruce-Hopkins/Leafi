import { Fragment, type ReactNode } from "react";
import { GitHubStar, Icon, RAW, REPO } from "../components";

type Seg = readonly [text: string, cls?: string];

/** Renders lines of [text, className] segments inside a <pre>, so braces need no escaping. */
function Lines({ lines }: { lines: readonly (readonly Seg[])[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {line.map(([text, cls], j) => (cls ? <span key={j} className={cls}>{text}</span> : <Fragment key={j}>{text}</Fragment>))}
          {i < lines.length - 1 ? "\n" : null}
        </Fragment>
      ))}
    </>
  );
}

export function WorksWith() {
  return (
    <div className="works">
      <div className="wrap">
        <span className="label">Use it from</span>
        <ul>
          {["Hermes", "Claude Code", "Claude Desktop", "Cursor", "Any MCP client", "Your terminal"].map((n) => <li key={n}>{n}</li>)}
        </ul>
      </div>
    </div>
  );
}

// Real output: this flow was validated and drawn with the CLI.
const TERMINAL: readonly (readonly Seg[])[] = [
  [["$ ", "p"], ["agents-automations validate --graph morning-brief.json"]],
  [["{"], ['"ok"', "k"], [":"], ["true", "g"], [","], ['"issues"', "k"], [":[],"], ['"warnings"', "k"], [":[],"], ['"minimum"', "k"], [":{ … "], ['"totalTokens"', "k"], [":3020 }}"]],
  [],
  [["$ ", "p"], ["agents-automations graph --graph morning-brief.json"]],
  [["Morning brief (3 nodes, 2 edges)"]],
  [],
  [["[Front page · claude-haiku-5-5]"]],
  [["  --> [Briefing]"]],
  [["[Weather · claude-haiku-5-5]"]],
  [["  --> [Briefing]"]],
  [["  [Briefing · claude-haiku-5-5]  (person reads this)"]],
  [],
  [["# Looks right? Then run it:", "c"]],
  [["$ ", "p"], ["agents-automations run --graph morning-brief.json"]],
];

const FLOW_JSON = `{
  "name": "Morning brief",
  "nodes": [
    {
      "id": "news",
      "label": "Front page",
      "provider": "anthropic",
      "model": "claude-haiku-5-5",
      "permissions": { "bash": true },
      "prompt": "Run one run_bash call: curl -s 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=15' | jq '[.hits[] | {title, url, points, num_comments}]'. Pick the five stories a software engineer would most want to know about and write a short paragraph on each … If the call fails, say so; never invent a story."
    },
    {
      "id": "weather",
      "label": "Weather",
      "provider": "anthropic",
      "model": "claude-haiku-5-5",
      "permissions": { "bash": true },
      "prompt": "Run one run_bash call: curl -s 'https://api.open-meteo.com/v1/forecast?…' | jq '.daily'. Report today's high, low and chance of rain in two sentences. If the call fails, say so; never guess."
    },
    {
      "id": "brief",
      "label": "Briefing",
      "provider": "anthropic",
      "model": "claude-haiku-5-5",
      "audience": "person",
      "inputs": ["news", "weather"],
      "prompt": "The reader is a software engineer starting their day. Brief them the way a sharp colleague would over coffee … Link each story."
    }
  ],
  "edges": [
    { "source": "news", "target": "brief" },
    { "source": "weather", "target": "brief" }
  ]
}`;

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Ask your agent",
    body: (
      <>
        <p>In plain words, from the agent you already use.</p>
        <blockquote className="ask">
          Use agents-automations to find this month's most-cited arXiv papers on small code models and brief me on
          them in a few paragraphs. You may use web, not bash.
        </blockquote>
      </>
    ),
  },
  {
    title: "It designs and checks the flow",
    body: <p>Validation is free: no model calls. Malformed flows are rejected, and a design lint flags flows that would cost more than a single agent doing the same job.</p>,
  },
  {
    title: "You see it before it runs",
    body: <p>You get the diagram, the model on every node and the minimum tokens it needs. Nothing runs, and nothing is spent, until you say so.</p>,
  },
  {
    title: "It runs, reports, and is saved",
    body: <p>The result comes back with tokens and cost per node. The flow is saved under its name, so "run my morning brief" works next week too.</p>,
  },
];

export function HowItWorks() {
  return (
    <section id="how">
      <div className="wrap">
        <div className="section-head">
          <div className="kicker">How it works</div>
          <h2>Describe the job once. Run it whenever.</h2>
          <p>A flow is a small graph of agents in JSON. Each node has a model, a prompt and only the tools it needs, and it hands its result to the next.</p>
        </div>
        <div className="steps">
          <ol className="step-list">
            {STEPS.map((s) => (
              <li key={s.title}>
                <h3>{s.title}</h3>
                {s.body}
              </li>
            ))}
          </ol>
          <div>
            <div className="terminal">
              <div className="terminal-bar"><i /><i /><i /><span>~/flows</span></div>
              <pre><Lines lines={TERMINAL} /></pre>
            </div>
            <details className="flow-json">
              <summary>morning-brief.json</summary>
              <pre>{FLOW_JSON}</pre>
            </details>
          </div>
        </div>
      </div>
    </section>
  );
}

const FEATURES: { icon: ReactNode; title: string; body: ReactNode }[] = [
  {
    icon: Icon.shield,
    title: "Checked before it spends",
    body: <><code>validate</code> makes no model calls. It catches broken wiring, and its lint flags design mistakes, such as a branch decided on a vibe or two nodes writing the same file, with a hint for the fix. Keys and mailbox logins are checked before the first token.</>,
  },
  {
    icon: Icon.dollar,
    title: "What it actually cost",
    body: <>Every run reports tokens, model calls and <code>costUsd</code> per node, including cache and reasoning tokens. It's the billed amount when the provider reports one, list price otherwise, and it says which.</>,
  },
  {
    icon: Icon.lock,
    title: "Permissions per node",
    body: <>A node holds only the tools it's granted: read, write, bash, web, browser and read-only email. Bash, email and browser start off, and you're asked before a flow that needs one runs.</>,
  },
  {
    icon: Icon.branch,
    title: "Branches, fan-out and joins",
    body: <>Pick one path on a measurable condition, run independent sources side by side, and wait for all of them at a join. Every node runs once, and the graph has no cycles, so a run always ends.</>,
  },
  {
    icon: Icon.doc,
    title: "Handoffs with a contract",
    body: <>A node can declare the shape of what it passes on, such as a line count, a per-line pattern or a required section. Output that doesn't match goes back to that node with the reason, not downstream.</>,
  },
  {
    icon: Icon.save,
    title: "Flows that stay",
    body: <>Every flow your agent runs is saved by name, so it outlives the conversation that wrote it. Your agent lists your saved flows before designing a new one.</>,
  },
];

export function Features() {
  return (
    <section id="features" className="band">
      <div className="wrap">
        <div className="section-head">
          <div className="kicker">Features</div>
          <h2>Small, checked and accountable.</h2>
          <p>Built to keep flows cheap and predictable: fewer nodes, tighter prompts, and a clear record of what each run did and cost.</p>
        </div>
        <div className="features">
          {FEATURES.map((f) => (
            <article className="feature" key={f.title}>
              <div className="icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
        <div className="providers">
          <span>Mix models per node from</span>
          {["OpenAI", "Anthropic", "Google", "OpenRouter"].map((p, i) => (
            <Fragment key={p}>
              {i > 0 && <span aria-hidden="true">·</span>}
              <strong>{p}</strong>
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

const INSTALL_CARDS: { title: string; body: ReactNode; lines: readonly (readonly Seg[])[] }[] = [
  {
    title: "One-line installer",
    body: "Finds Hermes, Claude Code, Claude Desktop and Cursor and installs into the ones you tick. Run it again to repeat the setup.",
    lines: [
      [["# macOS, Linux, WSL2", "c"]],
      [[`curl -fsSL ${RAW}/install.sh | sh`]],
      [],
      [["# Windows PowerShell", "c"]],
      [[`irm ${RAW}/install.ps1 | iex`]],
    ],
  },
  {
    title: "Hermes plugin",
    body: "Install and enable the plugin, run its setup, then restart Hermes.",
    lines: [
      [["hermes plugins install Bruce-Hopkins/agent-automations/hermes-plugin --enable"]],
      [["node ~/.hermes/plugins/agents-automations/dist/server.mjs init"]],
    ],
  },
  {
    title: "Any MCP client",
    body: <>The server is a single file. <code>init</code> ends by printing the entry to paste into your client's <code>mcpServers</code>.</>,
    lines: [
      [["mkdir -p -m 700 ~/.agents-automations"]],
      [["curl -fsSL -o ~/.agents-automations/server.mjs \\"]],
      [[`  ${RAW}/hermes-plugin/dist/server.mjs`]],
      [["node ~/.agents-automations/server.mjs init"]],
    ],
  },
  {
    title: "From source",
    body: "For working on the CLI itself. You'll also need pnpm.",
    lines: [
      [[`git clone ${REPO}.git`]],
      [["cd agent-automations"]],
      [["pnpm install && pnpm build"]],
      [["node dist/main.js --help"]],
    ],
  },
];

export function Install() {
  return (
    <section id="install">
      <div className="wrap">
        <div className="section-head">
          <div className="kicker">Install</div>
          <h2>Pick how you'll use it.</h2>
          <p>Every option needs Node.js 22 or newer. Setup asks for a provider key and which tools flows may use.</p>
        </div>
        <div className="install-grid">
          {INSTALL_CARDS.map((c) => (
            <div className="card" key={c.title}>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
              <pre><Lines lines={c.lines} /></pre>
            </div>
          ))}
        </div>
        <div className="callout" role="note">
          {Icon.warn}
          <div>
            <h3>Bash and browser are not sandboxed</h3>
            <p>
              A node with <code>bash</code> can run any command you can, and a <code>browser</code> node can reach your
              local network. Text from web pages and emails can steer an agent, so a node that reads untrusted content
              shouldn't also hold <code>bash</code> or <code>write</code>. Read{" "}
              <a href={`${REPO}/blob/main/SECURITY.md`}>SECURITY.md</a> before running a flow you didn't write.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="final band">
      <div className="wrap">
        <h2>Early, and moving fast.</h2>
        <p>This is a prototype with updates on the way. Star the repo to follow along, or open an issue with the automation you'd want it to run.</p>
        <div className="cta-row">
          <GitHubStar />
          <a className="btn" href={`${REPO}/issues`}>Open an issue</a>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer>
      <div className="wrap">
        <span>MIT licensed · by Bruce Hopkins</span>
        <nav aria-label="Footer">
          <a href={`${REPO}#readme`}>README</a>
          <a href={`${REPO}/blob/main/agents/HOW_TO_DESIGN_YOUR_FLOW.md`}>Flow design guide</a>
          <a href={`${REPO}/blob/main/AGENTS.md`}>Agent reference</a>
          <a href={`${REPO}/blob/main/SECURITY.md`}>Security</a>
        </nav>
      </div>
    </footer>
  );
}
