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
  parent: "hermes" | string;
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
}

export interface Layout {
  viewBox: { w: number; h: number };
  hub: Hub;
  /** Where lines leave the hub (bottom centre of the box). */
  anchor: Pt;
  nodes: readonly FlowNode[];
  nodeRadius: number;
  cornerRadius: number;
  font: { label: number; sub: number; hub: number; hubSub: number };
}

// Hermes on top starts one planning agent. Every split after that is an agent
// too: Plan hands work left and right, and each of those hands it on again.
export const desktop: Layout = {
  viewBox: { w: 1600, h: 600 },
  hub: { label: "Hermes", sub: "designs & runs your flow", box: { x: 600, y: 24, w: 400, h: 100, r: 20 } },
  anchor: [800, 124],
  nodeRadius: 28,
  cornerRadius: 12,
  font: { label: 26, sub: 17, hub: 40, hubSub: 17 },
  nodes: [
    {
      id: "plan", label: "Plan", sub: "glm-5.3-flash", parent: "hermes", labelSide: "below",
      route: [[800, 124], [800, 214]],
    },
    {
      id: "triage", label: "Triage", sub: "gpt-6-luna", parent: "plan", labelSide: "left",
      route: [[800, 214], [520, 214]],
    },
    {
      id: "inbox", label: "Inbox", sub: "claude-haiku-5-5", parent: "triage", labelSide: "left",
      route: [[520, 214], [520, 126], [260, 126]],
    },
    {
      id: "research", label: "Research", sub: "deepseek-v4.1-flash", parent: "triage", labelSide: "below",
      route: [[520, 214], [520, 340]],
    },
    {
      id: "arxiv", label: "arXiv", sub: "gemini-3.8-flash", parent: "research", labelSide: "below",
      route: [[520, 340], [720, 340], [720, 480]],
    },
    {
      id: "summarise", label: "Summarise", sub: "claude-haiku-5-5", parent: "research", labelSide: "below",
      route: [[520, 340], [320, 340], [320, 480]],
    },
    {
      id: "calendar", label: "Calendar", sub: "gpt-6-luna", parent: "plan", labelSide: "right",
      route: [[800, 214], [1080, 214]],
    },
    {
      id: "weather", label: "Weather", sub: "deepseek-v4.1-flash", parent: "calendar", labelSide: "right",
      route: [[1080, 214], [1080, 126], [1320, 126]],
    },
    {
      id: "briefing", label: "Briefing", sub: "for you to read", parent: "calendar", labelSide: "below", person: true,
      route: [[1080, 214], [1080, 340], [1300, 340], [1300, 480]],
    },
  ],
};

// Phones: the same idea, taller than wide, with fewer nodes.
export const mobile: Layout = {
  viewBox: { w: 600, h: 660 },
  hub: { label: "Hermes", sub: "designs & runs your flow", box: { x: 140, y: 24, w: 320, h: 96, r: 18 } },
  anchor: [300, 120],
  nodeRadius: 26,
  cornerRadius: 12,
  font: { label: 26, sub: 17, hub: 36, hubSub: 17 },
  nodes: [
    {
      id: "plan", label: "Plan", sub: "glm-5.3-flash", parent: "hermes", labelSide: "right",
      route: [[300, 120], [300, 210]],
    },
    {
      id: "inbox", label: "Inbox", sub: "claude-haiku-5-5", parent: "plan", labelSide: "below",
      route: [[300, 210], [110, 210]],
    },
    {
      id: "research", label: "Research", sub: "deepseek-v4.1-flash", parent: "plan", labelSide: "below",
      route: [[300, 210], [300, 390]],
    },
    {
      id: "arxiv", label: "arXiv", sub: "gemini-3.8-flash", parent: "research", labelSide: "below",
      route: [[300, 390], [120, 390], [120, 530]],
    },
    {
      id: "briefing", label: "Briefing", sub: "for you to read", parent: "research", labelSide: "below", person: true,
      route: [[300, 390], [480, 390], [480, 530]],
    },
  ],
};
