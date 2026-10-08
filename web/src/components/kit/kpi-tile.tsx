// Stat figures, echo/Zenith-style: numbers in the condensed display cut, counting up with GSAP.
// KpiBand = one full-width coloured band of 2–4 figures. KpiTile = a single card.
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./animated-number";
import { formatNumber } from "./format";
import { TONE_CLASS, type Tone } from "./panel";

export interface KpiDelta {
  value: number;
  /** What it's compared with, e.g. "vs FCFS", "vs last week". */
  label: string;
  /** Which direction is good news. */
  better: "up" | "down";
  decimals?: number;
}

export interface KpiFigure {
  label: string;
  value: number;
  /** Renders "value/total", e.g. 8/8 placed. */
  total?: number;
  /** Small unit after the figure: "%", "h", "seats". */
  unit?: string;
  decimals?: number;
  compact?: boolean;
  delta?: KpiDelta;
}

function Figure({ value, total, unit, decimals, compact, className }: Omit<KpiFigure, "label" | "delta"> & { className?: string }) {
  return (
    <p className={cn("figure flex items-baseline", className)}>
      <AnimatedNumber value={value} decimals={decimals} compact={compact} />
      {total !== undefined && <span className="ml-[0.08em] text-[0.55em] opacity-45">/{formatNumber(total)}</span>}
      {unit && <span className="ml-1 text-[0.42em] tracking-[-0.02em] opacity-60">{unit}</span>}
    </p>
  );
}

export function Delta({ value, label, better, decimals = 0 }: KpiDelta) {
  const direction = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const good = direction === "flat" ? null : direction === better;
  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : Minus;
  return (
    <p
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs font-medium tracking-[0.06em] uppercase",
        good === true && "text-(--delta-good)",
        good === false && "text-(--delta-bad)",
        good === null && "text-fg-3",
      )}
    >
      <Icon className="size-3.5" strokeWidth={2.5} aria-hidden />
      {formatNumber(Math.abs(value), { decimals })} {label}
      <span className="sr-only">{good === true ? "(better)" : good === false ? "(worse)" : ""}</span>
    </p>
  );
}

/** A full-width band of headline figures (echo's transparency band). */
export function KpiBand({
  items,
  tone = "forest",
  className,
}: {
  items: KpiFigure[];
  tone?: "forest" | "ink" | "volt" | "white";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-10 rounded-[1.75rem] px-7 py-9 md:px-12 md:py-12",
        items.length >= 4 ? "lg:grid-cols-4" : items.length === 3 ? "lg:grid-cols-3" : "",
        TONE_CLASS[tone],
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-3">
          <Figure {...item} className="text-[clamp(3.5rem,6.4vw,6rem)] text-fg" />
          <p className="text-[15px] text-fg-2">{item.label}</p>
          {item.delta && <Delta {...item.delta} />}
        </div>
      ))}
    </div>
  );
}

/** One stat card: icon bubble, label, figure, optional badge and delta (Zenith dashboard). */
export function KpiTile(
  props: KpiFigure & {
    icon?: ReactNode;
    badge?: ReactNode;
    footnote?: ReactNode;
    tone?: Tone;
    className?: string;
  },
) {
  const { label, icon, badge, footnote, delta, tone = "white", className, ...figure } = props;
  return (
    <div className={cn("flex min-h-52 flex-col justify-between gap-6 rounded-[1.75rem] p-7", TONE_CLASS[tone], className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-4">
          {icon && (
            <span className="grid size-11 place-items-center rounded-full bg-fg/[0.07] text-fg [&_svg]:size-5">{icon}</span>
          )}
          <p className="text-[17px] leading-tight font-semibold tracking-[-0.01em] text-fg">{label}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-end justify-between gap-3">
          <Figure {...figure} className="text-[3.75rem] text-fg" />
          {badge && <span className="mb-2">{badge}</span>}
        </div>
        {delta && <Delta {...delta} />}
        {footnote && <p className="text-sm text-fg-3">{footnote}</p>}
      </div>
    </div>
  );
}
