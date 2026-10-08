// One place that registers GSAP plugins for the kit. Import gsap from here, not from "gsap".
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, Flip);

/** Animate only for people who haven't asked for reduced motion. */
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";
export const MOTION_REDUCED = "(prefers-reduced-motion: reduce)";

export { Flip, gsap, ScrollTrigger, SplitText, useGSAP };

/** False where there is no matchMedia (tests) or the user has not allowed motion work to run. */
export function canAnimate(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && !navigator.userAgent.includes("jsdom");
}
