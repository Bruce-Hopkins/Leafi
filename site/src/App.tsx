import { useEffect, useState } from "react";
import { Hero } from "./hero/Hero";
import { Footer, Goals, Prototype } from "./sections/Sections";

const BASE = import.meta.env.BASE_URL;

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Goals />
        <Prototype />
      </main>
      <Footer />
    </>
  );
}

/** Just the logo. Clear while it sits over the hero; the page's own theme after that. */
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
        <a className="logo" href="#top" aria-label="leafi, back to top">
          <img src={`${BASE}leaf.svg`} alt="" width={34} height={34} />
        </a>
      </div>
    </header>
  );
}
