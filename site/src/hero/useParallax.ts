import { useEffect, type RefObject } from "react";

/**
 * Writes the scroll offset (--sy, px) and the pointer position (--px, --py, -1..1)
 * onto the element as CSS variables, at most once per frame. Layers inside move
 * themselves from those variables, so React never re-renders while scrolling.
 *
 * Off while the element is off screen, and entirely off for reduced motion.
 */
export function useParallax(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
    let frame = 0;
    let visible = true;
    // Pointer: where it is (target) and where the layers are (eased toward it).
    let tx = 0, ty = 0, cx = 0, cy = 0;

    const tick = () => {
      frame = 0;
      el.style.setProperty("--sy", String(Math.round(Math.min(window.scrollY, el.offsetHeight))));
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      el.style.setProperty("--px", cx.toFixed(4));
      el.style.setProperty("--py", cy.toFixed(4));
      if (Math.abs(tx - cx) > 0.0005 || Math.abs(ty - cy) > 0.0005) schedule();
    };
    const schedule = () => {
      if (!frame && visible) frame = requestAnimationFrame(tick);
    };
    const onPointer = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth) * 2 - 1;
      ty = (e.clientY / window.innerHeight) * 2 - 1;
      schedule();
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      schedule();
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      schedule();
    });
    io.observe(el);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    if (finePointer) {
      window.addEventListener("pointermove", onPointer, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
    }
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [ref]);
}
