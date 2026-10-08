// The brand mark floating on the dither globe. It leans toward the cursor (a small 3D tilt and parallax), a soft glow
// follows the pointer across it, a click sends a ripple through the globe behind, and at rest it drifts slowly.
// Motion is decorative: it is switched off for reduced-motion users and the image carries an empty alt.
import { useEffect, useRef } from "react";
import { pulseFrom } from "./dither-field";

export function LogoGlobe({ size = "42%" }: { size?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const tilt = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    const card = el?.parentElement;     // the globe panel
    if (!el || !card || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const target = { x: 0, y: 0, gx: 50, gy: 50, on: 0 };
    const cur = { x: 0, y: 0, gx: 50, gy: 50, on: 0 };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      for (const k of ["x", "y", "gx", "gy", "on"] as const) cur[k] += (target[k] - cur[k]) * 0.1;
      if (tilt.current) tilt.current.style.transform = `perspective(700px) rotateY(${cur.x * 14}deg) rotateX(${-cur.y * 14}deg) translate3d(${cur.x * 12}px, ${cur.y * 12}px, 0) scale(${1 + cur.on * 0.04})`;
      if (glow.current) {
        glow.current.style.background = `radial-gradient(circle at ${cur.gx}% ${cur.gy}%, rgb(212 255 58 / ${0.5 * cur.on}), transparent 55%)`;
        glow.current.style.opacity = String(0.3 + cur.on * 0.7);
      }
    };
    const move = (e: PointerEvent) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      target.x = (px - 0.5) * 2; target.y = (py - 0.5) * 2; target.gx = px * 100; target.gy = py * 100; target.on = 1;
    };
    const leave = () => { target.x = 0; target.y = 0; target.gx = 50; target.gy = 50; target.on = 0; };
    const click = (e: PointerEvent) => pulseFrom(el, 1.6) ?? void e;
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerleave", leave);
    card.addEventListener("pointerdown", click);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerleave", leave);
      card.removeEventListener("pointerdown", click);
    };
  }, []);

  return (
    <div ref={host} aria-hidden className="pointer-events-none absolute inset-0 z-[1] grid place-items-center">
      <div className="logo-drift relative" style={{ width: size, aspectRatio: "1" }}>
        <div ref={glow} className="absolute -inset-[30%] rounded-full opacity-30 blur-2xl transition-opacity" />
        <div ref={tilt} className="relative h-full w-full will-change-transform [transform-style:preserve-3d]">
          <img src="/claimshield-mark.webp" alt="" draggable={false} className="h-full w-full object-contain drop-shadow-[0_18px_40px_rgb(0_0_0/0.45)]" />
        </div>
      </div>
    </div>
  );
}
