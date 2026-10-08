// Button label that rolls up to a fresh copy on hover (echo's CTAs). Pure CSS — works inside any
// element with the `group/button` class (every Button / buttonVariants link has it).
import type { ReactNode } from "react";

export function RollLabel({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-flex overflow-hidden">
      <span className="inline-flex items-center gap-[inherit] transition-transform duration-500 ease-out-expo group-hover/button:-translate-y-full motion-reduce:transition-none">
        {children}
      </span>
      <span
        aria-hidden
        className="absolute inset-0 inline-flex translate-y-full items-center gap-[inherit] transition-transform duration-500 ease-out-expo group-hover/button:translate-y-0 motion-reduce:hidden"
      >
        {children}
      </span>
    </span>
  );
}
