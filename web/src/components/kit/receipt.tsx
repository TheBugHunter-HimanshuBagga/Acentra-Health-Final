// The evidence receipt: every component of a score written out as value x weight, then the total.
// Used for the risk drivers of a case; the numbers always come from the backend, this only draws them.
import { cn } from "@/lib/utils";

export interface ReceiptRow {
  key: string;
  label: string;
  /** 0..1 */
  value: number;
  /** share of the total, 0..1 */
  weight: number;
  hint?: string;
}

const COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-6)"];

export function ScoreReceipt({ rows, total, caption = "risk", className }: { rows: ReceiptRow[]; total: number; caption?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3.5", className)}>
      {rows.map((r, i) => (
        <div key={r.key} className="flex flex-col gap-1.5" title={r.hint}>
          <div className="flex items-baseline justify-between gap-3 font-mono text-xs">
            <span className="text-fg-2">{r.label}</span>
            <span className="text-fg">{r.value.toFixed(2)} <span className="text-fg-3">× {r.weight.toFixed(2)}</span></span>
          </div>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-viz-track">
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(0, Math.min(1, r.value)) * 100}%`, background: COLORS[i % COLORS.length] }} />
          </div>
        </div>
      ))}
      <p className="mt-1 flex items-baseline gap-3 border-t border-line pt-4">
        <span className="figure text-[2.75rem] text-fg">= {total.toFixed(2)}</span>
        <span className="font-mono text-xs tracking-[0.08em] text-fg-3 uppercase">{caption}</span>
      </p>
    </div>
  );
}

/** One stacked bar: each segment is a component's share. */
export function StackBar({ rows, className }: { rows: { key: string; label: string; share: number }[]; className?: string }) {
  const sum = rows.reduce((s, r) => s + r.share, 0) || 1;
  let at = 0;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div role="img" aria-label="Share of each component" className="relative h-2.5 w-full overflow-hidden rounded-full bg-viz-track">
        {rows.map((r, i) => {
          const w = (r.share / sum) * 100;
          const left = at;
          at += w;
          return <span key={r.key} className="absolute inset-y-0 rounded-full" style={{ left: `${left}%`, width: `max(2px, calc(${w}% - 2px))`, background: COLORS[i % COLORS.length] }} />;
        })}
      </div>
      <ul className="grid grid-cols-2 gap-x-5 gap-y-1">
        {rows.map((r, i) => (
          <li key={r.key} className="flex items-center gap-2 text-[13px]">
            <span className="size-2 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="truncate text-fg-2">{r.label}</span>
            <span className="ml-auto font-mono text-xs text-fg">{Math.round((r.share / sum) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
