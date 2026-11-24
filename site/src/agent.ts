// Each landing page names the agent it is for on its #root element
// (data-agent="hermes"); the root page names none and speaks to any agent.

import type { Caller } from "./hero/FlowDiagram";

export interface AgentCopy {
  /** The box on top of the hero diagram, where the person asks. */
  caller: Caller;
  installNote: string;
}

const AGENTS = {
  any: {
    caller: { label: "Your agent", sub: "designs the flow" },
    installNote: "Needs Node.js 22 or newer. The installer finds your agent and sets it up there.",
  },
  hermes: {
    caller: { label: "Hermes", sub: "your agent" },
    installNote: "Needs Node.js 22 or newer. The installer finds Hermes and sets it up there.",
  },
} satisfies Record<string, AgentCopy>;

export function agentCopy(name: string | undefined): AgentCopy {
  return name && name in AGENTS ? AGENTS[name as keyof typeof AGENTS] : AGENTS.any;
}
