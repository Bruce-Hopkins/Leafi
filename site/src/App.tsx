import { useEffect, useState } from "react";
import { Icon, REPO } from "./components";
import { Hero } from "./hero/Hero";
import { FinalCta, Features, Footer, HowItWorks, Install, WorksWith } from "./sections/Sections";

const BASE = import.meta.env.BASE_URL;

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <WorksWith />
        <HowItWorks />
        <Features />
        <Install />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}

/** Light-on-dark while it sits over the hero; the page's own theme after that. */
function Nav() {
  const [onHero, setOnHero] = useState(true);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const hero = document.getElementById("top");
      setOnHero(hero ? hero.getBoundingClientRect().bottom > 64 : false);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <header className={`nav${onHero ? " on-hero" : ""}`}>
      <div className="wrap">
        <a className="brand" href="#top">
          <img src={`${BASE}favicon.svg`} alt="" width={26} height={26} />
          agents-automations
        </a>
        <nav className="nav-links" aria-label="Main">
          <a className="hide-sm" href="#how">How it works</a>
          <a className="hide-sm" href="#features">Features</a>
          <a className="hide-sm" href="#install">Install</a>
          <a className="btn btn-sm" href={REPO}>
            {Icon.github}
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
