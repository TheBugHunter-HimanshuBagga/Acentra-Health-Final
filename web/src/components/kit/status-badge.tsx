// Case status pill, Allotiq-style: mono caps with a dot. Colour never carries meaning alone, the label is always
// there. Live states pulse. Statuses are the platform's own workflow states.
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "waitlisted" | "pending" | "approved" | "checked_in" | "completed" | "rejected" | "expired" | "bumped";

export const STATUS_META: Record<string, { label: string; tone: Tone; live?: boolean }> = {
  NEW: { label: "New", tone: "pending", live: true },
  IN_REVIEW: { label: "In review", tone: "checked_in", live: true },
  ACTION_PROPOSED: { label: "Action proposed", tone: "pending", live: true },
  ACTION_APPROVED: { label: "Action approved", tone: "approved", live: true },
  ACTION_TAKEN: { label: "Action taken", tone: "checked_in" },
  PENDING_APPROVAL: { label: "Awaiting approval", tone: "pending", live: true },
  APPROVED: { label: "Approved", tone: "approved", live: true },
  EXECUTED: { label: "Executed", tone: "completed" },
  REJECTED: { label: "Rejected", tone: "rejected" },
  CLOSED: { label: "Closed", tone: "completed" },
  RECORDED: { label: "Recorded", tone: "waitlisted" },
  MONITOR: { label: "Monitor", tone: "expired" },
  WAITING: { label: "Waiting", tone: "pending", live: true },
  ACTIVE: { label: "Active", tone: "approved", live: true },
  DRAFT: { label: "Draft", tone: "waitlisted" },
  SIMULATED: { label: "Simulated", tone: "bumped" },
  RETIRED: { label: "Retired", tone: "expired" },
};

const SIZE = {
  sm: "h-5 gap-1.5 px-2 text-[10px]",
  md: "h-6 gap-1.5 px-2.5 text-[11px]",
  lg: "h-8 gap-2 px-3.5 text-[13px]",
};

export function StatusBadge({
  status,
  size = "md",
  className,
}: {
  status: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const meta = STATUS_META[status] ?? { label: status.replace(/_/g, " ").toLowerCase(), tone: "waitlisted" as Tone };
  const { label, live, tone } = { live: false, ...meta };
  const vars = {
    "--st": `var(--st-${tone})`,
    "--st-bg": `var(--st-${tone}-bg)`,
    "--st-fg": `var(--st-${tone}-fg)`,
  } as CSSProperties;
  return (
    <span
      data-status={status}
      style={vars}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-(--st-bg) font-mono font-medium tracking-[0.08em] whitespace-nowrap text-(--st-fg) uppercase",
        SIZE[size],
        className,
      )}
    >
      <span className="relative flex size-1.5" aria-hidden>
        {live && (
          <span className="absolute inline-flex size-full animate-[live-ping_2s_ease-out_infinite] rounded-full bg-(--st) motion-reduce:animate-none" />
        )}
        <span className="relative inline-flex size-1.5 rounded-full bg-(--st)" />
      </span>
      {label}
    </span>
  );
}

/** A neutral mono tag in the same shape: "BEST MATCH", "FIXED IN 1 DAY". */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full bg-fg/[0.07] px-2.5 font-mono text-[11px] font-medium tracking-[0.08em] whitespace-nowrap text-fg-2 uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}
