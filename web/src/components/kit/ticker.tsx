// A slow mono marquee of what just happened (echo's hero strip). Presentational — feed it from the
// audit_log Realtime hook (Aditi · D13) or, on a hero, recent requests in the requesters' words.
import { cn } from "@/lib/utils";

export interface TickerItem {
  id: string;
  /** Display time, e.g. "13:42" or "2 min ago". */
  at: string;
  text: string;
  status?: "waitlisted" | "pending" | "approved" | "checked_in" | "completed" | "rejected" | "expired" | "bumped";
}

export function Ticker({
  items,
  label,
  quotes = false,
  className,
}: {
  items: TickerItem[];
  /** Fixed label on the left, e.g. "Live". */
  label?: string;
  /** Wrap each item in quotes (requests in their own words). */
  quotes?: boolean;
  className?: string;
}) {
  if (items.length === 0) return null;
  const run = (copy: "a" | "b") =>
    items.map((item) => (
      <li key={`${copy}-${item.id}`} aria-hidden={copy === "b" || undefined} className="flex items-center gap-3 pr-12">
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: item.status ? `var(--st-${item.status})` : "var(--color-tangerine)" }}
          aria-hidden
        />
        <span className="whitespace-nowrap text-fg-2">{quotes ? `“${item.text}”` : item.text}</span>
        <span className="whitespace-nowrap text-fg-3">{item.at}</span>
      </li>
    ));
  return (
    <div className={cn("flex h-11 items-center overflow-hidden border-t border-line font-mono text-[12.5px]", className)}>
      {label && (
        <p className="eyebrow z-10 flex h-full shrink-0 items-center gap-2 border-r border-line pr-4 pl-6 text-fg-2 md:pl-10">
          <span className="relative flex size-2" aria-hidden>
            <span className="absolute inline-flex size-full animate-[live-ping_1.8s_ease-out_infinite] rounded-full bg-mint motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-mint" />
          </span>
          {label}
        </p>
      )}
      <div className="relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_5%,#000_95%,transparent)]">
        <ul
          className="flex w-max animate-[marquee_linear_infinite] pl-6 hover:[animation-play-state:paused] motion-reduce:animate-none"
          style={{ animationDuration: `${Math.max(30, items.length * 8)}s` }}
        >
          {run("a")}
          {run("b")}
        </ul>
      </div>
    </div>
  );
}
