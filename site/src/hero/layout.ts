// The hero diagram, as data. Coordinates are in the SVG's viewBox units, so the
// drawing scales with the screen and nothing here is in pixels.
//
// Every node names its parent and the corner points of the line that reaches it,
// from the parent's anchor to the node's centre. Lines from the same parent
// start together and grow at the same speed, so a stretch two routes share is
// drawn as one line that then forks: repeat the shared corners exactly.

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

// Traced from the sketch: Hermes on top, one trunk down to a bus that splits
// left and right; the left-middle node is itself a hub with two children.
export const desktop: Layout = {
  viewBox: { w: 1600, h: 600 },
  hub: { label: "Hermes", sub: "designs & runs your flow", box: { x: 600, y: 24, w: 400, h: 100, r: 20 } },
  anchor: [800, 124],
  nodeRadius: 28,
  cornerRadius: 12,
  font: { label: 26, sub: 17, hub: 40, hubSub: 17 },
  nodes: [
    {
      id: "inbox", label: "Inbox", sub: "claude-haiku-5-5", parent: "hermes", labelSide: "below",
      route: [[800, 124], [800, 204], [520, 204], [520, 126], [250, 126]],
    },
    {
      id: "research", label: "Research", sub: "gpt-4o-mini", parent: "hermes", labelSide: "left",
      route: [[800, 124], [800, 204], [520, 204], [520, 288], [370, 288]],
    },
    {
      id: "arxiv", label: "arXiv", sub: "gemini-2.5-flash", parent: "research", labelSide: "below",
      route: [[370, 288], [370, 372], [660, 372], [660, 470]],
    },
    {
      id: "summarise", label: "Summarise", sub: "claude-haiku-5-5", parent: "research", labelSide: "below",
      route: [[370, 288], [370, 372], [370, 420], [200, 420], [200, 500]],
    },
    {
      id: "weather", label: "Weather", sub: "gpt-4o-mini", parent: "hermes", labelSide: "right",
      route: [[800, 124], [800, 204], [1100, 204], [1100, 160], [1310, 160], [1310, 84]],
    },
    {
      id: "briefing", label: "Briefing", sub: "for you to read", parent: "hermes", labelSide: "below", person: true,
      route: [[800, 124], [800, 204], [1100, 204], [1100, 288], [1420, 288], [1420, 470]],
    },
  ],
};

// Phones: the same idea, taller than wide, with one node fewer.
export const mobile: Layout = {
  viewBox: { w: 600, h: 660 },
  hub: { label: "Hermes", sub: "designs & runs your flow", box: { x: 140, y: 24, w: 320, h: 96, r: 18 } },
  anchor: [300, 120],
  nodeRadius: 26,
  cornerRadius: 12,
  font: { label: 26, sub: 17, hub: 36, hubSub: 17 },
  nodes: [
    {
      id: "inbox", label: "Inbox", sub: "claude-haiku-5-5", parent: "hermes", labelSide: "below",
      route: [[300, 120], [300, 200], [120, 200], [120, 290]],
    },
    {
      id: "weather", label: "Weather", sub: "gpt-4o-mini", parent: "hermes", labelSide: "below",
      route: [[300, 120], [300, 200], [480, 200], [480, 290]],
    },
    {
      id: "research", label: "Research", sub: "gpt-4o-mini", parent: "hermes", labelSide: "right",
      route: [[300, 120], [300, 200], [300, 410]],
    },
    {
      id: "arxiv", label: "arXiv", sub: "gemini-2.5-flash", parent: "research", labelSide: "below",
      route: [[300, 410], [300, 470], [120, 470], [120, 550]],
    },
    {
      id: "briefing", label: "Briefing", sub: "for you to read", parent: "research", labelSide: "below", person: true,
      route: [[300, 410], [300, 470], [480, 470], [480, 550]],
    },
  ],
};
