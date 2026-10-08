// A number that counts to its value with GSAP — on mount, and again whenever the value changes
// (the Lab's KPI counters "tick up"). The final value reserves the width, so nothing shifts.
import { useMemo, useRef } from "react";
import { formatNumber, type NumberFormat } from "./format";
import { MOTION_OK, MOTION_REDUCED, canAnimate, gsap, useGSAP } from "./motion";

export function AnimatedNumber(props: NumberFormat & { value: number; duration?: number; className?: string }) {
  const { value, decimals = 0, compact = false, duration = 1.3, className } = props;
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const counted = useRef(false);
  const format = useMemo(() => (v: number) => formatNumber(v, { decimals, compact }), [decimals, compact]);
  const final = format(value);

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
        const counter = { v: shown.current };
        el.textContent = format(counter.v);
        gsap.set(el, { autoAlpha: 1 });
        gsap.to(counter, {
          v: value,
          duration,
          ease: "power3.out",
          // The first count waits until the number is on screen; later changes tween at once.
          scrollTrigger: counted.current ? undefined : { trigger: el, start: "top 92%", once: true },
          onStart: () => {
            counted.current = true;
          },
          onUpdate: () => {
            shown.current = counter.v;
            el.textContent = format(counter.v);
          },
        });
      });
      mm.add(MOTION_REDUCED, () => {
        shown.current = value;
        el.textContent = format(value);
        gsap.set(el, { autoAlpha: 1 });
      });
    },
    { dependencies: [value, format, duration], scope: ref },
  );

  return (
    <span className={`inline-grid ${className ?? ""}`}>
      <span className="sr-only">{final}</span>
      {/* width reservation */}
      <span aria-hidden className="invisible col-start-1 row-start-1">
        {final}
      </span>
      {/* GSAP owns this node's text, so React must not render children into it */}
      <span
        ref={ref}
        aria-hidden
        data-reveal=""
        className="col-start-1 row-start-1"
        dangerouslySetInnerHTML={{ __html: final }}
      />
    </span>
  );
}
