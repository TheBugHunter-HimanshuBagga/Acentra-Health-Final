// Cards. Light tones reset tokens (`light`), dark ones flip them (`dark`), so anything inside —
// status pills, score bars, shadcn primitives — renders correctly on any section.
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type Tone = "white" | "bone" | "volt" | "mint" | "outline" | "ink" | "forest";

export const TONE_CLASS: Record<Tone, string> = {
  white: "light bg-white text-brand-ink",
  bone: "light bg-brand-bone text-brand-ink",
  volt: "light bg-volt text-brand-ink",
  mint: "light bg-mint text-brand-ink",
  /** OneClick "receipt": white with a 2px ink rule. */
  outline: "light bg-white text-brand-ink ring-2 ring-brand-ink ring-inset",
  ink: "dark bg-brand-ink-2 text-brand-bone ring-1 ring-white/[0.06] ring-inset",
  forest:
    "dark bg-forest text-brand-bone [--card:rgb(255_255_255/0.08)] [--line:rgb(255_255_255/0.14)] [--viz-track:rgb(255_255_255/0.16)] [--fg-3:#b4d6c6]",
};

export function Panel({ tone = "white", className, ...props }: ComponentProps<"div"> & { tone?: Tone }) {
  return <div className={cn("relative overflow-hidden rounded-[1.75rem]", TONE_CLASS[tone], className)} {...props} />;
}
