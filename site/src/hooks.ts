import { useEffect, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";

/** True once the element has been on screen; it stays true, so an animation plays once. */
export function useInViewOnce(ref: RefObject<Element | null>, threshold = 0.2) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen, threshold]);
  return seen;
}

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
  );
}

/** Inline CSS custom properties, typed loosely enough for React's style prop. */
export function cssVars(vars: Record<`--${string}`, string | number>): CSSProperties {
  return vars as CSSProperties;
}

/** Seconds as a CSS time. */
export const sec = (s: number) => `${Math.round(s * 1000)}ms`;
