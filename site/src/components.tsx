import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export const REPO = "https://github.com/Bruce-Hopkins/leafi";
export const RAW = "https://raw.githubusercontent.com/Bruce-Hopkins/leafi/main";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Icon = {
  star: <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>,
  clip: <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>,
  check: <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2.4} aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>,
  dollar: <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>,
  repeat: <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="m17 1 4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="m7 23-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>,
  sliders: <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>,
};

export function CopyButton({ text, label = "Copy command" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing else to try */
      }
      ta.remove();
    }
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1600);
  };

  return (
    <button className={`copy${done ? " done" : ""}`} type="button" aria-label={done ? "Copied" : label} onClick={copy}>
      {done ? Icon.check : Icon.clip}
    </button>
  );
}

const INSTALL = [
  { id: "unix", tab: "macOS · Linux · WSL2", prompt: "$", cmd: `curl -fsSL ${RAW}/install.sh | sh` },
  { id: "win", tab: "Windows", prompt: "PS>", cmd: `irm ${RAW}/install.ps1 | iex` },
] as const;

const isWindows = () => {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /^win/i.test(nav.userAgentData?.platform || navigator.platform || "");
};

export function InstallTabs() {
  const [active, setActive] = useState<number>(() => (isWindows() ? 1 : 0));
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = (i + (e.key === "ArrowRight" ? 1 : INSTALL.length - 1)) % INSTALL.length;
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="install">
      <div className="tabs" role="tablist" aria-label="Install command">
        {INSTALL.map((o, i) => (
          <button
            key={o.id}
            ref={(el) => { tabs.current[i] = el; }}
            className="tab"
            role="tab"
            id={`t-${o.id}`}
            aria-controls={`p-${o.id}`}
            aria-selected={active === i}
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {o.tab}
          </button>
        ))}
      </div>
      {INSTALL.map((o, i) => (
        <div key={o.id} className="cmd" role="tabpanel" id={`p-${o.id}`} aria-labelledby={`t-${o.id}`} hidden={active !== i}>
          <pre><span className="p">{o.prompt} </span><code>{o.cmd}</code></pre>
          <CopyButton text={o.cmd} label="Copy install command" />
        </div>
      ))}
    </div>
  );
}

export function GitHubStar({ children = "Star on GitHub" }: { children?: ReactNode }) {
  return (
    <a className="btn primary" href={REPO}>
      {Icon.star}
      {children}
    </a>
  );
}
