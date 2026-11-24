// The hero diagram, as data. Coordinates are in the SVG's viewBox units, so the
// drawing scales with the screen and nothing here is in pixels.
//
// It draws a flow leafi could really run: entry nodes that start together when
// the run begins, joins that wait for every line coming in, and one node at the
// end that a person reads. Every edge gives the corner points of its line, from
// the source's centre (or a point on leafi's border) to the target's centre.
// Lines only meet at a node, never part-way along, so lines leaving or reaching
// one node do so from different directions and share no stretch.

export type Pt = readonly [x: number, y: number];

export type LabelSide = "below" | "above" | "left" | "right";

export interface FlowNode {
  id: string;
  label: string;
  /** Second line under the label: the model this agent runs on. */
  sub: string;
  at: Pt;
  labelSide: LabelSide;
  /** The node a person reads: drawn in the accent colour. */
  person?: boolean;
}

export interface FlowEdge {
  /** "leafi" for an entry node: leafi starts it when the run begins. */
  from: "leafi" | string;
  to: string;
  /** Corner points, from the source to the target's centre. */
  route: readonly Pt[];
}

export interface Box {
  /** Rounded box: x, y of the top-left corner, then width and height. */
  box: { x: number; y: number; w: number; h: number; r: number };
  font: { label: number; sub: number };
}

export interface Hub extends Box {
  label: string;
  sub: string;
}

export interface Layout {
  viewBox: { w: number; h: number };
  /** The agent the person asks, the smaller box on top. Its words come from the page. */
  caller: Box;
  /** leafi, below it: checks and runs the flow, so every entry line leaves it. */
  hub: Hub;
  nodes: readonly FlowNode[];
  edges: readonly FlowEdge[];
  nodeRadius: number;
  cornerRadius: number;
  /** Arrowhead at the end of every line: tip to back, and the full width across the back. */
  arrow: { length: number; width: number };
  font: { label: number; sub: number };
}

// A morning briefing. Four cheap agents fetch at once: the inbox, Hacker News,
// arXiv and the weather. The two news feeds join in Digest, which reads the
// articles and hands on short notes, so the bulk never reaches the writer.
// Briefing waits for Inbox, Digest and Weather, then writes for you.
export const desktop: Layout = {
  viewBox: { w: 1600, h: 696 },
  caller: { box: { x: 670, y: 16, w: 260, h: 60, r: 16 }, font: { label: 26, sub: 14 } },
  hub: { label: "Leafi", sub: "checks & runs the flow", box: { x: 600, y: 120, w: 400, h: 100, r: 20 }, font: { label: 40, sub: 17 } },
  nodeRadius: 28,
  cornerRadius: 12,
  arrow: { length: 15, width: 14 },
  font: { label: 26, sub: 17 },
  nodes: [
    { id: "inbox", label: "Inbox", sub: "claude-haiku-5-5", at: [260, 340], labelSide: "left" },
    { id: "hn", label: "Hacker News", sub: "gemini-3.8-flash", at: [640, 340], labelSide: "left" },
    { id: "arxiv", label: "arXiv", sub: "deepseek-v4.1-flash", at: [960, 340], labelSide: "right" },
    { id: "weather", label: "Weather", sub: "glm-5.3-flash", at: [1340, 340], labelSide: "right" },
    { id: "digest", label: "Digest", sub: "gpt-6-luna", at: [800, 450], labelSide: "above" },
    { id: "briefing", label: "Briefing", sub: "for you to read", at: [800, 576], labelSide: "below", person: true },
  ],
  edges: [
    { from: "leafi", to: "inbox", route: [[600, 170], [260, 170], [260, 340]] },
    { from: "leafi", to: "hn", route: [[640, 220], [640, 340]] },
    { from: "leafi", to: "arxiv", route: [[960, 220], [960, 340]] },
    { from: "leafi", to: "weather", route: [[1000, 170], [1340, 170], [1340, 340]] },
    { from: "hn", to: "digest", route: [[640, 340], [640, 450], [800, 450]] },
    { from: "arxiv", to: "digest", route: [[960, 340], [960, 450], [800, 450]] },
    { from: "inbox", to: "briefing", route: [[260, 340], [260, 576], [800, 576]] },
    { from: "digest", to: "briefing", route: [[800, 450], [800, 576]] },
    { from: "weather", to: "briefing", route: [[1340, 340], [1340, 576], [800, 576]] },
  ],
};

// Phones: the same flow, taller than wide, without arXiv and Digest.
export const mobile: Layout = {
  viewBox: { w: 600, h: 748 },
  caller: { box: { x: 195, y: 16, w: 210, h: 56, r: 14 }, font: { label: 26, sub: 14 } },
  hub: { label: "Leafi", sub: "checks & runs the flow", box: { x: 140, y: 112, w: 320, h: 96, r: 18 }, font: { label: 36, sub: 17 } },
  nodeRadius: 26,
  cornerRadius: 12,
  arrow: { length: 17, width: 16 },
  font: { label: 26, sub: 17 },
  nodes: [
    { id: "inbox", label: "Inbox", sub: "claude-haiku-5-5", at: [180, 320], labelSide: "below" },
    { id: "hn", label: "Hacker News", sub: "gemini-3.8-flash", at: [420, 320], labelSide: "below" },
    { id: "weather", label: "Weather", sub: "glm-5.3-flash", at: [300, 470], labelSide: "right" },
    { id: "briefing", label: "Briefing", sub: "for you to read", at: [300, 620], labelSide: "below", person: true },
  ],
  edges: [
    { from: "leafi", to: "inbox", route: [[180, 208], [180, 320]] },
    { from: "leafi", to: "weather", route: [[300, 208], [300, 470]] },
    { from: "leafi", to: "hn", route: [[420, 208], [420, 320]] },
    { from: "inbox", to: "briefing", route: [[180, 320], [60, 320], [60, 620], [300, 620]] },
    { from: "weather", to: "briefing", route: [[300, 470], [300, 620]] },
    { from: "hn", to: "briefing", route: [[420, 320], [540, 320], [540, 620], [300, 620]] },
  ],
};
