// Turns a Layout into SVG paths and the moment each piece appears.
//
// Every line is drawn at one constant speed, starting when its parent node
// appears, so the lines leaving one node grow together. Keep the timing
// linear: never ease the draw.

import type { FlowNode, Layout, Pt } from "./layout";

export const TIMING = {
  /** Hermes's border starts drawing (s). */
  hubStart: 0.15,
  hubDraw: 0.6,
  /** The trunk leaves Hermes (s). */
  linesStart: 0.8,
  /** Drawing speed, viewBox units per second. */
  speed: 950,
  /** Pause at a node, while it pops in, before its own lines start (s). */
  pop: 0.16,
  /** After everything is drawn, pulses travel the lines at this speed. */
  pulseSpeed: 520,
  pulseLength: 28,
  /** Quiet time between rounds of pulses (s). */
  pulseRest: 1.6,
} as const;

export interface TimedEdge {
  node: FlowNode;
  center: Pt;
  d: string;
  /** Path length in viewBox units. */
  length: number;
  /** Seconds after the diagram goes live. */
  delay: number;
  duration: number;
  arrive: number;
  /** Dash pattern for the travelling pulse, in pathLength units (the path is 1 long). */
  pulse: { dash: number; gap: number; from: number; to: number; delay: number };
}

export interface Timeline {
  hub: { left: string; right: string };
  edges: TimedEdge[];
  /** When the last node has finished popping in. */
  end: number;
  pulsePeriod: number;
}

type MutPt = [number, number];

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const n2 = (v: number) => Math.round(v * 100) / 100;
const n2Fine = (v: number) => Math.round(v * 10000) / 10000;

function at(points: readonly Pt[], i: number): Pt {
  const p = points[i];
  if (!p) throw new Error(`route point ${i} missing`);
  return p;
}

/** Shortens a route at either end so a line stops at a node's rim, not its centre. */
function trim(points: readonly Pt[], start: number, end: number): Pt[] {
  const out: MutPt[] = points.map((p) => [p[0], p[1]]);
  const pull = (a: MutPt, toward: Pt, by: number) => {
    const len = dist(a, toward);
    if (len === 0 || by === 0) return;
    a[0] += ((toward[0] - a[0]) / len) * by;
    a[1] += ((toward[1] - a[1]) / len) * by;
  };
  const last = out.length - 1;
  pull(out[0] as MutPt, at(points, 1), start);
  pull(out[last] as MutPt, at(points, last - 1), end);
  return out;
}

/** A polyline with rounded corners, and its exact length. Straight-through points are skipped. */
function roundedPath(points: readonly Pt[], radius: number): { d: string; length: number } {
  const first = at(points, 0);
  let d = `M${n2(first[0])} ${n2(first[1])}`;
  let length = 0;
  let cur: Pt = first;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = at(points, i - 1);
    const p = at(points, i);
    const next = at(points, i + 1);
    const l1 = dist(prev, p);
    const l2 = dist(p, next);
    const v1: Pt = [(p[0] - prev[0]) / l1, (p[1] - prev[1]) / l1];
    const v2: Pt = [(next[0] - p[0]) / l2, (next[1] - p[1]) / l2];
    const cross = v1[0] * v2[1] - v1[1] * v2[0];
    if (Math.abs(cross) < 1e-6) continue;

    const turn = Math.acos(Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1])));
    // Distance from the corner to where the arc meets each segment.
    const t = Math.min(radius * Math.tan(turn / 2), l1 / 2, l2 / 2);
    const r = t / Math.tan(turn / 2);
    const a: Pt = [p[0] - v1[0] * t, p[1] - v1[1] * t];
    const b: Pt = [p[0] + v2[0] * t, p[1] + v2[1] * t];

    d += ` L${n2(a[0])} ${n2(a[1])} A${n2(r)} ${n2(r)} 0 0 ${cross > 0 ? 1 : 0} ${n2(b[0])} ${n2(b[1])}`;
    length += dist(cur, a) + r * turn;
    cur = b;
  }

  const last = at(points, points.length - 1);
  d += ` L${n2(last[0])} ${n2(last[1])}`;
  length += dist(cur, last);
  return { d, length };
}

/** Hermes's border as two halves that start at the top and meet at the bottom, where the trunk leaves. */
function hubHalves({ x, y, w, h, r }: Layout["hub"]["box"]) {
  const cx = x + w / 2;
  return {
    left: `M${cx} ${y} H${x + r} A${r} ${r} 0 0 0 ${x} ${y + r} V${y + h - r} A${r} ${r} 0 0 0 ${x + r} ${y + h} H${cx}`,
    right: `M${cx} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${cx}`,
  };
}

export function buildTimeline(layout: Layout): Timeline {
  const { nodes, nodeRadius: R, cornerRadius } = layout;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const timed = new Map<string, TimedEdge>();

  const visit = (node: FlowNode): TimedEdge => {
    const done = timed.get(node.id);
    if (done) return done;

    const fromHub = node.parent === "hermes";
    let start: number = TIMING.linesStart;
    let pStart = 0;
    if (!fromHub) {
      const parent = byId.get(node.parent);
      if (!parent) throw new Error(`node ${node.id}: unknown parent ${node.parent}`);
      const pe = visit(parent);
      start = pe.arrive + TIMING.pop;
      // The pulse runs the parent's line, then crosses the parent node (two radii).
      pStart = pe.pulse.delay + (pe.length + 2 * R) / TIMING.pulseSpeed;
    }

    const center = at(node.route, node.route.length - 1);
    const { d, length } = roundedPath(trim(node.route, fromHub ? 0 : R, R), cornerRadius);
    const duration = length / TIMING.speed;
    const edge: TimedEdge = {
      node,
      center,
      d,
      length,
      delay: start,
      duration,
      arrive: start + duration,
      // Filled in once the pulse period is known.
      pulse: { dash: TIMING.pulseLength / length, gap: 0, from: 0, to: 0, delay: pStart },
    };
    timed.set(node.id, edge);
    return edge;
  };
  nodes.forEach(visit);

  const edges = nodes.map((n) => timed.get(n.id) as TimedEdge);
  const end = Math.max(...edges.map((e) => e.arrive)) + 0.5;

  // One period for every pulse, long enough for the farthest leaf, so a round
  // of pulses leaves Hermes together and splits at the same nodes as the lines.
  const travel = Math.max(...edges.map((e) => e.pulse.delay + (e.length + TIMING.pulseLength) / TIMING.pulseSpeed));
  const pulsePeriod = travel + TIMING.pulseRest;
  const pulsesBegin = end + 0.6;
  for (const e of edges) {
    // Over one period the pulse's head moves period × speed; past the end of the path it is simply not drawn.
    const run = (pulsePeriod * TIMING.pulseSpeed) / e.length;
    e.pulse = {
      dash: n2Fine(e.pulse.dash),
      gap: n2Fine(run + 1),
      from: n2Fine(e.pulse.dash),
      to: n2Fine(e.pulse.dash - run),
      delay: n2(pulsesBegin + e.pulse.delay),
    };
  }

  return { hub: hubHalves(layout.hub.box), edges, end, pulsePeriod: n2(pulsePeriod) };
}
