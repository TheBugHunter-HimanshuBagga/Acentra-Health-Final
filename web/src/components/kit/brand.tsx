// ClaimShield mark: a 3x3 grid of claims with the flagged cell lit. Colours follow the surrounding tone (--mark-*).
import { cn } from "@/lib/utils";

const CELLS: [x: number, y: number, opacity: number][] = [
  [5, 5, 0.92], [13, 5, 0.38], [21, 5, 0.62],
  [5, 13, 0.38], [21, 13, 0.92],
  [5, 21, 0.62], [13, 21, 0.92], [21, 21, 0.38],
];

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7 shrink-0", className)}>
      <rect width="32" height="32" rx="8" fill="var(--mark-tile)" />
      {CELLS.map(([x, y, o]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="6" height="6" rx="1" fill="var(--mark-cell)" opacity={o} />
      ))}
      <rect x="13" y="13" width="6" height="6" rx="1" fill="var(--mark-lit)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-[1.1875rem] leading-none font-semibold tracking-[-0.045em]">claimshield</span>
    </span>
  );
}
