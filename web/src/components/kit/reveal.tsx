// GSAP entrances (echo timings). Content is server-rendered; [data-reveal] keeps it hidden until
// GSAP takes over (see globals.css), so there is no flash and no-JS / reduced-motion users still
// see everything.
import { useRef, type ElementType, type ReactNode } from "react";
import { MOTION_OK, MOTION_REDUCED, SplitText, canAnimate, gsap, useGSAP } from "./motion";

type TextTag = "h1" | "h2" | "h3" | "p" | "div" | "span";

/** Headline whose characters rise out of a per-line mask. */
export function RevealText(props: {
  as?: TextTag;
  children: ReactNode;
  className?: string;
  delay?: number;
  /** "chars" for display headlines (echo), "lines" for long copy. */
  by?: "chars" | "lines";
  /** Start when scrolled into view instead of on mount. */
  onScroll?: boolean;
}) {
  const { as = "h1", children, className, delay = 0.2, by = "chars", onScroll = false } = props;
  const ref = useRef<HTMLElement>(null);
  const Tag = as as ElementType;

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (!canAnimate()) {
        el.style.visibility = "visible";
        return;
      }
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const split = SplitText.create(el, {
          type: by === "chars" ? "lines,chars" : "lines",
          mask: "lines",
          autoSplit: true,
          onSplit(self) {
            gsap.set(el, { autoAlpha: 1 });
            return gsap.from(by === "chars" ? self.chars : self.lines, {
              yPercent: 120,
              duration: 1.3,
              ease: "expo.out",
              stagger: by === "chars" ? 0.022 : 0.1,
              delay,
              scrollTrigger: onScroll ? { trigger: el, start: "top 85%", once: true } : undefined,
            });
          },
        });
        return () => split.revert();
      });
      mm.add(MOTION_REDUCED, () => {
        gsap.set(el, { autoAlpha: 1 });
      });
    },
    { scope: ref },
  );

  return (
    <Tag ref={ref} data-reveal="" className={className}>
      {children}
    </Tag>
  );
}

/** Fades and lifts its direct children in, one after another. */
export function Reveal(props: {
  children: ReactNode;
  className?: string;
  delay?: number;
  stagger?: number;
  y?: number;
  onScroll?: boolean;
}) {
  const { children, className, delay = 0, stagger = 0.08, y = 32, onScroll = false } = props;
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (!canAnimate()) {
        el.style.visibility = "visible";
        return;
      }
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.set(el, { autoAlpha: 1 });
        gsap.from(el.children, {
          y,
          autoAlpha: 0,
          duration: 1,
          ease: "expo.out",
          stagger,
          delay,
          clearProps: "transform,opacity,visibility",
          scrollTrigger: onScroll ? { trigger: el, start: "top 88%", once: true } : undefined,
        });
      });
      mm.add(MOTION_REDUCED, () => {
        gsap.set(el, { autoAlpha: 1 });
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} data-reveal="" className={className}>
      {children}
    </div>
  );
}

/** A statement whose words light up as it scrolls through the viewport. */
export function ScrollWords({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (!canAnimate()) {
        el.style.visibility = "visible";
        return;
      }
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const split = SplitText.create(el, { type: "words" });
        gsap.fromTo(
          split.words,
          { opacity: 0.16 },
          {
            opacity: 1,
            ease: "none",
            stagger: 0.1,
            scrollTrigger: { trigger: el, start: "top 78%", end: "bottom 42%", scrub: 0.6 },
          },
        );
        return () => split.revert();
      });
    },
    { scope: ref },
  );

  return (
    <p ref={ref} className={className}>
      {children}
    </p>
  );
}
