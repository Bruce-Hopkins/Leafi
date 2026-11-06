import { useRef } from "react";
import { GitHubStar, InstallTabs } from "../components";
import { cssVars, useInViewOnce, useMediaQuery } from "../hooks";
import { FlowDiagram } from "./FlowDiagram";
import { desktop, mobile } from "./layout";
import { useParallax } from "./useParallax";

/**
 * Three layers at different depths: a faint far-away background, the diagram,
 * and the copy in front. The diagram's lines and nodes share one layer: on
 * separate layers they would slide apart as the page scrolls.
 */
export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const isPhone = useMediaQuery("(max-width: 719px)");
  const live = useInViewOnce(ref);
  useParallax(ref);

  return (
    <section className="hero" ref={ref} id="top">
      <div className="hero-layer hero-bg" style={cssVars({ "--speed": 0.2, "--depth": -10 })} aria-hidden="true">
        <Ambient />
      </div>

      <div className="hero-stage">
        <div className="hero-layer hero-diagram" style={cssVars({ "--speed": 0.55, "--depth": 18 })}>
          <div className="hero-tilt">
            <FlowDiagram key={isPhone ? "phone" : "wide"} layout={isPhone ? mobile : desktop} live={live} />
          </div>
        </div>
      </div>

      <div className="hero-copy">
        <div className="wrap">
          <span className="eyebrow"><span className="pulse-dot" />Open source · MIT · early prototype</span>
          <h1>Automations built from <em>linked LLM&nbsp;agents</em>.</h1>
          <InstallTabs />
          <p className="install-note">Needs Node.js 22 or newer. The installer finds Hermes and sets it up there.</p>
          <div className="cta-row">
            <GitHubStar />
            <a className="btn ghost" href="#goals">Why use it</a>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Far-off circuitry that sells the depth. Static, blurred and faint. */
function Ambient() {
  const lines: { d: string; c: [number, number] }[] = [
    { d: "M-10 600 H150 V800 H318", c: [332, 800] },
    { d: "M1610 470 H1490 V720 H1334", c: [1320, 720] },
    { d: "M60 -10 V90 H176", c: [190, 90] },
    { d: "M1540 -10 V60 H1424", c: [1410, 60] },
    { d: "M560 1010 V900 H756", c: [770, 900] },
    { d: "M1100 1010 V860 H1240 V806", c: [1240, 792] },
    { d: "M-10 300 H70 V418", c: [70, 432] },
    { d: "M1610 160 H1520 V300 H1440", c: [1426, 300] },
  ];
  return (
    <svg className="ambient" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
      {lines.map(({ d, c }) => (
        <g key={d}>
          <path d={d} />
          <circle cx={c[0]} cy={c[1]} r={14} />
        </g>
      ))}
    </svg>
  );
}
