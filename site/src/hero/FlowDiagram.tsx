import { useId, useMemo } from "react";
import { cssVars, sec } from "../hooks";
import type { Layout, Pt } from "./layout";
import type { Hub } from "./layout";
import { buildTimeline, type TimedBox, type TimedEdge } from "./timeline";

interface Props {
  layout: Layout;
  /** Start the build animation. Before this everything past the background is hidden. */
  live: boolean;
}

export function FlowDiagram({ layout, live }: Props) {
  const t = useMemo(() => buildTimeline(layout), [layout]);
  const ids = useId();
  const titleId = `${ids}-title`;
  const glowId = `${ids}-glow`;
  const { w, h } = layout.viewBox;
  const lines = [{ id: "link", ...t.link }, ...t.edges.map((e) => ({ id: e.node.id, ...e }))];

  return (
    <svg
      className={`flow${live ? " is-live" : ""}`}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-labelledby={titleId}
      style={cssVars({ "--pulse-period": sec(t.pulsePeriod) })}
    >
      <title id={titleId}>{describe(layout)}</title>
      <defs>
        <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Hermes, then leafi below it: each border draws from the top and closes at the bottom, where its line leaves. */}
      <HubBox hub={layout.caller} timing={t.caller} />
      <HubBox hub={layout.hub} timing={t.hub} />

      <g className="edges">
        {lines.map((e) => <path key={`g-${e.id}`} className="edge-glow" d={e.d} pathLength={1} style={drawVars(e)} />)}
        {lines.map((e) => <path key={`l-${e.id}`} className="edge" d={e.d} pathLength={1} style={drawVars(e)} />)}
      </g>

      <g className="pulses" filter={`url(#${glowId})`}>
        {lines.map((e) => (
          <path
            key={`p-${e.id}`} className="pulse" d={e.d} pathLength={1}
            style={cssVars({
              "--pd": e.pulse.dash, "--pg": e.pulse.gap,
              "--pf": e.pulse.from, "--pt": e.pulse.to,
              "--pdelay": sec(e.pulse.delay),
            })}
          />
        ))}
      </g>

      <g className="nodes">
        {t.edges.map((e) => <NodeMark key={e.node.id} edge={e} layout={layout} />)}
      </g>
    </svg>
  );
}

/** A rounded box with a bold label and a mono line under it, the pair centred in the box. */
function HubBox({ hub, timing }: { hub: Hub; timing: TimedBox }) {
  const { box, font } = hub;
  const cx = box.x + box.w / 2;
  const cap = (size: number) => size * 0.7;
  const gap = Math.max(8, font.sub * 0.7);
  const top = box.y + (box.h - (cap(font.label) + gap + cap(font.sub))) / 2;
  const labelY = top + cap(font.label);
  const subY = labelY + gap + cap(font.sub);
  return (
    <g className="hub">
      <rect
        className="hub-fill"
        x={box.x} y={box.y} width={box.w} height={box.h} rx={box.r}
        style={cssVars({ "--at": sec(timing.start + 0.25) })}
      />
      {[timing.left, timing.right].map((d, i) => (
        <path
          key={i} className="hub-stroke" d={d} pathLength={1}
          style={cssVars({ "--delay": sec(timing.start), "--dur": sec(timing.draw) })}
        />
      ))}
      <text className="hub-label" x={cx} y={labelY} fontSize={font.label} style={cssVars({ "--at": sec(timing.start + 0.35) })}>
        {hub.label}
      </text>
      <text className="hub-sub" x={cx} y={subY} fontSize={font.sub} style={cssVars({ "--at": sec(timing.start + 0.5) })}>
        {hub.sub}
      </text>
    </g>
  );
}

function NodeMark({ edge, layout }: { edge: TimedEdge; layout: Layout }) {
  const R = layout.nodeRadius;
  const [x, y] = edge.center;
  const { node } = edge;
  const label = labelPlacement(edge.center, R, node.labelSide, layout.font);
  return (
    <g className={`node${node.person ? " is-person" : ""}`} style={cssVars({ "--at": sec(edge.arrive) })}>
      <circle className="node-ripple" cx={x} cy={y} r={R} />
      <g className="node-core">
        <circle className="node-ring" cx={x} cy={y} r={R} />
        <circle className="node-dot" cx={x} cy={y} r={R * 0.3} />
      </g>
      <g className="node-text" textAnchor={label.anchor}>
        <text className="node-label" x={label.x} y={label.labelY} fontSize={layout.font.label}>{node.label}</text>
        <text className="node-sub" x={label.x} y={label.subY} fontSize={layout.font.sub}>{node.sub}</text>
      </g>
    </g>
  );
}

type Anchor = "start" | "middle" | "end";

function labelPlacement(
  [x, y]: Pt,
  R: number,
  side: Layout["nodes"][number]["labelSide"],
  font: Layout["font"],
): { x: number; anchor: Anchor; labelY: number; subY: number } {
  if (side === "below") {
    const labelY = y + R + 12 + font.label * 0.8;
    return { x, anchor: "middle", labelY, subY: labelY + font.sub + 8 };
  }
  const gap = R + 16;
  return {
    x: side === "left" ? x - gap : x + gap,
    anchor: side === "left" ? "end" : "start",
    labelY: y - 3,
    subY: y + font.sub + 5,
  };
}

function drawVars(e: { delay: number; duration: number }) {
  return cssVars({ "--delay": sec(e.delay), "--dur": sec(e.duration) });
}

function describe(layout: Layout) {
  const children = (parent: string) => layout.nodes.filter((n) => n.parent === parent);
  const tell = (parent: string): string =>
    children(parent)
      .map((n) => {
        const next = tell(n.id);
        return next ? `${n.label} (which hands work on to ${next})` : n.label;
      })
      .join(" and ");
  return `${layout.caller.label} hands a task to ${layout.hub.label}, which starts a flow of agent nodes: ${tell("leafi")}.`;
}
