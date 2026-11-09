// The hero diagram, as data. Coordinates are in the SVG's viewBox units, so the
// drawing scales with the screen and nothing here is in pixels.
//
// Every node names its parent and the corner points of the line that reaches it,
// from the parent's centre to the node's centre. A line only ever splits at a
// node, never part-way along, as in a real flow: an agent decides where work
// goes next. So routes from one parent must leave it in different directions
// and share no stretch.

export type Pt = readonly [x: number, y: number];

export type LabelSide = "below" | "left" | "right";

export interface FlowNode {
  id: string;
  label: string;
  /** Second line under the label: the model this agent runs on. */
  sub: string;
  parent: "leafi" | string;
  route: readonly Pt[];
  labelSide: LabelSide;
  /** The node a person reads: drawn in the accent colour. */
  person?: boolean;
}

export interface Hub {
  label: string;
  sub: string;
  /** Rounded box: x, y of the top-left corner, then width and height. */
  box: { x: number; y: number; w: number; h: number; r: number };
  font: { label: number; sub: number };
}

export interface Layout {
  viewBox: { w: number; h: number };
  /** Hermes, where the person asks: the smaller box on top. */
  caller: Hub;
  /** leafi, below it: designs and runs the flow, so every agent line leaves it. */
  hub: Hub;
  /** Where lines leave the hub (bottom centre of the box). */
  anchor: Pt;
  nodes: readonly FlowNode[];
  nodeRadius: number;
  cornerRadius: number;
  font: { label: number; sub: number };
}

// Hermes on top hands the task to leafi, which starts one planning agent.
// Every split after that is an agent too: Plan hands work left and right, and
// each of those hands it on again.
export const desktop: Layout = {
  viewBox: { w: 1600, h: 696 },
  caller: { label: "Hermes", sub: "your agent", box: { x: 670, y: 16, w: 260, h: 60, r: 16 }, font: { label: 26, sub: 14 } },
  hub: { label: "Leafi", sub: "checks & runs the flow", box: { x: 600, y: 120, w: 400, h: 100, r: 20 }, font: { label: 40, sub: 17 } },
  anchor: [800, 220],
  nodeRadius: 28,
  cornerRadius: 12,
  font: { label: 26, sub: 17 },
  nodes: [
    {
      id: "plan", label: "Plan", sub: "glm-5.3-flash", parent: "leafi", labelSide: "below",
      route: [[800, 220], [800, 310]],
    },
    {
      id: "triage", label: "Triage", sub: "gpt-6-luna", parent: "plan", labelSide: "left",
      route: [[800, 310], [520, 310]],
    },
    {
      id: "inbox", label: "Inbox", sub: "claude-haiku-5-5", parent: "triage", labelSide: "left",
      route: [[520, 310], [520, 222], [260, 222]],
    },
    {
      id: "research", label: "Research", sub: "deepseek-v4.1-flash", parent: "triage", labelSide: "below",
      route: [[520, 310], [520, 436]],
    },
    {
      id: "arxiv", label: "arXiv", sub: "gemini-3.8-flash", parent: "research", labelSide: "below",
      route: [[520, 436], [720, 436], [720, 576]],
    },
    {
      id: "summarise", label: "Summarise", sub: "claude-haiku-5-5", parent: "research", labelSide: "below",
      route: [[520, 436], [320, 436], [320, 576]],
    },
    {
      id: "calendar", label: "Calendar", sub: "gpt-6-luna", parent: "plan", labelSide: "right",
      route: [[800, 310], [1080, 310]],
    },
    {
      id: "weather", label: "Weather", sub: "deepseek-v4.1-flash", parent: "calendar", labelSide: "right",
      route: [[1080, 310], [1080, 222], [1320, 222]],
    },
    {
      id: "briefing", label: "Briefing", sub: "for you to read", parent: "calendar", labelSide: "below", person: true,
      route: [[1080, 310], [1080, 436], [1300, 436], [1300, 576]],
    },
  ],
};

// Phones: the same idea, taller than wide, with fewer nodes.
export const mobile: Layout = {
  viewBox: { w: 600, h: 748 },
  caller: { label: "Hermes", sub: "your agent", box: { x: 195, y: 16, w: 210, h: 56, r: 14 }, font: { label: 26, sub: 14 } },
  hub: { label: "Leafi", sub: "checks & runs the flow", box: { x: 140, y: 112, w: 320, h: 96, r: 18 }, font: { label: 36, sub: 17 } },
  anchor: [300, 208],
  nodeRadius: 26,
  cornerRadius: 12,
  font: { label: 26, sub: 17 },
  nodes: [
    {
      id: "plan", label: "Plan", sub: "glm-5.3-flash", parent: "leafi", labelSide: "right",
      route: [[300, 208], [300, 298]],
    },
    {
      id: "inbox", label: "Inbox", sub: "claude-haiku-5-5", parent: "plan", labelSide: "below",
      route: [[300, 298], [110, 298]],
    },
    {
      id: "research", label: "Research", sub: "deepseek-v4.1-flash", parent: "plan", labelSide: "below",
      route: [[300, 298], [300, 478]],
    },
    {
      id: "arxiv", label: "arXiv", sub: "gemini-3.8-flash", parent: "research", labelSide: "below",
      route: [[300, 478], [120, 478], [120, 618]],
    },
    {
      id: "briefing", label: "Briefing", sub: "for you to read", parent: "research", labelSide: "below", person: true,
      route: [[300, 478], [480, 478], [480, 618]],
    },
  ],
};
