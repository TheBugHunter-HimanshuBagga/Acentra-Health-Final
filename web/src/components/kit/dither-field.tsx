// Wave dither field — the echo field, in Allotiq's palette. Every cell sums a few soft signals
// (rings rolling out of wave sources, lit orbs, a glow off the floor, the cursor, and ripples from
// clicks or fast moves), then an 8×8 Bayer matrix picks one of the palette tones. Drawn as dots into
// a tiny canvas scaled up with pixelated rendering. Decorative only: aria-hidden, pauses off-screen
// and in background tabs, one still frame under reduced motion.
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** A point that rings roll out of. x/y are fractions of the field (y = 1 is the bottom edge). */
export interface WaveSource {
  x: number;
  y: number;
  strength?: number;
}
/** A lit sphere. r is a fraction of the field's short side. */
export interface Orb {
  x: number;
  y: number;
  r: number;
}

export interface DitherFieldProps {
  className?: string;
  /** Tones from faint to bright — each tone is one dither level. */
  palette?: string[];
  /** One dither cell, in CSS px. */
  cell?: number;
  shape?: "dot" | "square";
  sources?: WaveSource[];
  orbs?: Orb[];
  /** Glow rising from the bottom edge, 0…1. */
  floor?: number;
  gain?: number;
  interactive?: boolean;
  /** Cursor glow radius, px. */
  glow?: number;
}

/** Ink-section tones: forest shadows up to volt highlights. */
export const DITHER_GREEN = ["#123b2c", "#1e6a4b", "#41d58c", "#d4ff3a"];
/** Forest-section tones: darker and lighter than forest itself. */
export const DITHER_FOREST = ["#003f2d", "#16805a", "#41d58c", "#d4ff3a"];

const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30,
  54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23,
  61, 29, 53, 21,
].map((v) => (v + 0.5) / 64);

export const PULSE_EVENT = "allotiq:pulse";

/** Send a ripple through every field on the page from a point on screen. */
export function pulseAt(x: number, y: number, strength = 1.8) {
  window.dispatchEvent(new CustomEvent(PULSE_EVENT, { detail: { x, y, strength } }));
}
/** Ripple from the centre of an element — e.g. the button that just submitted a request. */
export function pulseFrom(el: Element | null, strength = 1.8) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  pulseAt(r.left + r.width / 2, r.top + r.height / 2, strength);
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface Pulse {
  x: number;
  y: number;
  t: number;
  s: number;
}

export function DitherField({
  className,
  palette = DITHER_GREEN,
  cell = 6,
  shape = "dot",
  sources = [{ x: 0.5, y: 1.05, strength: 1 }],
  orbs = [],
  floor = 0,
  gain = 1,
  interactive = true,
  glow = 120,
}: DitherFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Live-tunable without restarting the loop.
  const config = useRef({ palette, sources, orbs, floor, gain, glow });
  useEffect(() => {
    config.current = { palette, sources, orbs, floor, gain, glow };
  });

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!host || !canvas || !ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const px = shape === "dot" ? 3 : 1; // canvas pixels per cell
    const dot = shape === "dot" ? 2 : 1; // filled pixels per cell side
    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let image: ImageData | null = null;
    let frame = 0;
    let visible = true;
    let shown = false;
    const start = performance.now();
    const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, inside: false, lastX: 0, lastY: 0, lastT: 0 };
    let pulses: Pulse[] = [];

    const render = (time: number) => {
      if (!image) return;
      const { palette: tones_, sources: src_, orbs: orbs_, floor: floor_, gain: gain_, glow: glow_ } = config.current;
      const tones = tones_.map(rgb);
      const levels = tones.length;
      const data = image.data;
      data.fill(0);
      const falloff = Math.hypot(w, h) * 0.27;
      const short = Math.min(w, h);
      const glow2 = 2 * glow_ * glow_;
      const cursor = pointer.inside && interactive;
      const src = src_.map((s) => ({ x: s.x * w, y: s.y * h, k: s.strength ?? 1 }));
      const spheres = orbs_.map((o) => ({ x: o.x * w, y: o.y * h, r: o.r * short }));
      const rings = pulses.map((p) => {
        const age = time - p.t;
        return { x: p.x, y: p.y, rad: age * 330, amp: p.s * Math.exp(-age * 1.15) };
      });
      const stride = canvas.width * 4;

      for (let row = 0; row < rows; row++) {
        const cy = (row + 0.5) * cell;
        const vy = cy / h;
        for (let col = 0; col < cols; col++) {
          const cx = (col + 0.5) * cell;
          let v = 0;
          for (const s of src) {
            const d = Math.hypot(cx - s.x, cy - s.y);
            const wave = 0.5 + 0.5 * Math.sin(d * 0.03 - time * 1.6);
            v += s.k * 0.66 * wave * wave * wave * wave * Math.exp(-d / falloff);
          }
          const drift =
            Math.sin(cx * 0.011 + time * 0.35) * Math.sin(cy * 0.016 - time * 0.22) +
            Math.sin((cx + cy) * 0.006 + time * 0.18);
          if (floor_ > 0) v += floor_ * vy * vy * vy * (0.7 + 0.22 * drift);
          v += 0.02 * drift;
          for (const o of spheres) {
            const dx = (cx - o.x) / o.r;
            const dy = (cy - o.y) / o.r;
            const q = dx * dx + dy * dy;
            if (q < 1) {
              const lit = Math.max(0, -0.5 * dx - 0.55 * dy + 0.67 * Math.sqrt(1 - q));
              v += 0.1 + 0.78 * lit + 0.08 * Math.sin(cx * 0.09) * Math.sin(cy * 0.07 + 1.3);
            } else {
              v += 0.22 * Math.exp(-(Math.sqrt(q) - 1) * 5.5);
            }
          }
          if (cursor) {
            const dx = cx - pointer.x;
            const dy = cy - pointer.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < glow2 * 4) v += 0.62 * Math.exp(-d2 / glow2);
          }
          for (const r of rings) {
            if (r.amp < 0.02) continue;
            const d = Math.hypot(cx - r.x, cy - r.y);
            const a = d - r.rad;
            if (a > -40 && a < 40) v += r.amp * Math.exp(-(a * a) / 260);
            const b = d - r.rad * 0.7;
            if (b > -30 && b < 30) v += r.amp * 0.45 * Math.exp(-(b * b) / 160);
          }
          v *= gain_;
          if (v <= 0.004) continue;
          let level = Math.floor(v * levels + BAYER[(col & 7) + ((row & 7) << 3)]);
          if (level <= 0) continue;
          if (level > levels) level = levels;
          const [r, g, b] = tones[level - 1];
          const at = row * px * stride + col * px * 4;
          for (let yy = 0; yy < dot; yy++) {
            let i = at + yy * stride;
            for (let xx = 0; xx < dot; xx++) {
              data[i] = r;
              data[i + 1] = g;
              data[i + 2] = b;
              data[i + 3] = 255;
              i += 4;
            }
          }
        }
      }
      ctx.putImageData(image, 0, 0);
      pulses = pulses.filter((p) => time - p.t <= 3);
      if (!shown) {
        shown = true;
        host.style.opacity = "1";
      }
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      cols = Math.max(1, Math.ceil(w / cell));
      rows = Math.max(1, Math.ceil(h / cell));
      canvas.width = cols * px;
      canvas.height = rows * px;
      canvas.style.width = `${cols * cell}px`;
      canvas.style.height = `${rows * cell}px`;
      image = ctx.createImageData(canvas.width, canvas.height);
      render((performance.now() - start) / 1000);
    };

    const local = (clientX: number, clientY: number) => {
      const r = host.getBoundingClientRect();
      const x = clientX - r.left;
      const y = clientY - r.top;
      return { x, y, inside: x >= 0 && x <= r.width && y >= 0 && y <= r.height };
    };
    const addPulse = (x: number, y: number, s: number) => {
      pulses.push({ x, y, t: (performance.now() - start) / 1000, s });
      if (pulses.length > 14) pulses.shift();
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e.clientX, e.clientY);
      pointer.tx = p.x;
      pointer.ty = p.y;
      if (!pointer.inside && p.inside) {
        pointer.x = p.x;
        pointer.y = p.y;
      }
      pointer.inside = p.inside;
      if (!p.inside) return;
      const now = performance.now();
      const moved = Math.hypot(p.x - pointer.lastX, p.y - pointer.lastY);
      if (moved > 70 && now - pointer.lastT > 140) {
        addPulse(p.x, p.y, Math.min(1, 0.45 + moved / 400));
        pointer.lastX = p.x;
        pointer.lastY = p.y;
        pointer.lastT = now;
      }
    };
    const onDown = (e: PointerEvent) => {
      const p = local(e.clientX, e.clientY);
      if (p.inside) addPulse(p.x, p.y, 1.6);
    };
    const onLeave = () => {
      pointer.inside = false;
    };
    const onPulse = (e: Event) => {
      const { x, y, strength } = (e as CustomEvent<{ x: number; y: number; strength?: number }>).detail;
      const p = local(x, y);
      addPulse(p.x, p.y, strength ?? 1.8);
    };

    const loop = () => {
      frame = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      pointer.x += (pointer.tx - pointer.x) * 0.18;
      pointer.y += (pointer.ty - pointer.y) * 0.18;
      render((performance.now() - start) / 1000);
    };

    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(host);
    const viewObserver = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting), {
      rootMargin: "100px",
    });
    viewObserver.observe(host);
    resize();

    if (!reduced) {
      if (interactive) {
        window.addEventListener("pointermove", onMove, { passive: true });
        window.addEventListener("pointerdown", onDown, { passive: true });
        document.addEventListener("pointerleave", onLeave);
      }
      window.addEventListener(PULSE_EVENT, onPulse);
      frame = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      viewObserver.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener(PULSE_EVENT, onPulse);
    };
  }, [cell, shape, interactive]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      style={{ opacity: 0 }}
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-[2400ms] ease-out motion-reduce:transition-none",
        className,
      )}
    >
      <canvas ref={canvasRef} className="absolute top-0 left-0 [image-rendering:pixelated]" />
    </div>
  );
}
