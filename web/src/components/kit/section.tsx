// Page structure, echo-style: full-bleed colour sections, numbered mono eyebrows and giant
// two-line headlines whose second line (or last word) is a serif italic in the section's accent.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { RevealText } from "./reveal";

export type SectionTone = "bone" | "white" | "volt" | "mint" | "ink" | "forest";

/** Light tones reset tokens with `light`, dark ones flip them with `dark`. */
export const SECTION_TONE: Record<SectionTone, string> = {
  bone: "light bg-brand-bone text-brand-ink",
  white: "light bg-white text-brand-ink",
  volt: "light bg-volt text-brand-ink",
  mint: "light bg-mint text-brand-ink",
  ink: "dark bg-brand-ink text-brand-bone",
  forest:
    "dark bg-forest text-brand-bone [--card:rgb(255_255_255/0.08)] [--line:rgb(255_255_255/0.14)] [--viz-track:rgb(255_255_255/0.16)] [--fg-3:#b4d6c6]",
};

/** Full-bleed band with the page's content column inside. */
export function Section({
  tone = "bone",
  className,
  inner,
  children,
  backdrop,
  after,
  id,
}: {
  tone?: SectionTone;
  className?: string;
  /** Classes for the inner content column. */
  inner?: string;
  children: ReactNode;
  /** Full-bleed layer behind the content, e.g. a DitherField and its scrim. */
  backdrop?: ReactNode;
  /** Full-bleed strip after the content column, e.g. a Ticker. */
  after?: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      data-tone={tone === "ink" || tone === "forest" ? "dark" : "light"}
      className={cn("relative isolate overflow-hidden", SECTION_TONE[tone], className)}
    >
      {backdrop}
      <div className={cn("relative mx-auto w-full max-w-[88rem] px-6 md:px-10", inner)}>{children}</div>
      {after && <div className="relative">{after}</div>}
    </section>
  );
}

/** "02 · HOW IT DECIDES", or a pill with a live dot for hero labels. */
export function Eyebrow({
  index,
  children,
  pill,
  dot,
  className,
}: {
  index?: string;
  children: ReactNode;
  pill?: boolean;
  dot?: "live" | "volt" | "idle";
  className?: string;
}) {
  return (
    <p
      className={cn(
        "eyebrow inline-flex items-center gap-2.5 text-fg-3",
        pill && "h-8 rounded-full bg-fg/[0.06] px-3.5 text-fg-2 ring-1 ring-line",
        className,
      )}
    >
      {dot && (
        <span className="relative flex size-2" aria-hidden>
          {dot === "live" && (
            <span className="absolute inline-flex size-full animate-[live-ping_1.8s_ease-out_infinite] rounded-full bg-mint motion-reduce:animate-none" />
          )}
          <span
            className={cn(
              "relative inline-flex size-2 rounded-full",
              dot === "live" && "bg-mint",
              dot === "volt" && "bg-volt",
              dot === "idle" && "bg-fg-3",
            )}
          />
        </span>
      )}
      {index && <span>{index} ·</span>}
      {children}
    </p>
  );
}

const HEADLINE_SIZE = {
  hero: "display-hero",
  "1": "display-1",
  "2": "display-2",
  "3": "display-3",
};

/**
 * Two-line display headline: `lead` in the display cut, `accent` in serif italic (forest on light
 * sections, volt on dark). `inline` keeps the accent on the lead's line.
 */
export function Headline({
  as = "h2",
  size = "2",
  lead,
  accent,
  inline,
  reveal = true,
  onScroll,
  className,
}: {
  as?: "h1" | "h2" | "h3";
  size?: keyof typeof HEADLINE_SIZE;
  lead: ReactNode;
  accent?: ReactNode;
  inline?: boolean;
  reveal?: boolean;
  onScroll?: boolean;
  className?: string;
}) {
  const content = (
    <>
      {lead}
      {lead != null && lead !== "" && accent && (inline ? " " : <br />)}
      {accent && <span className="serif-accent pr-[0.04em] text-hl">{accent}</span>}
    </>
  );
  const classes = cn(HEADLINE_SIZE[size], "text-fg", className);
  if (!reveal) {
    const Tag = as;
    return <Tag className={classes}>{content}</Tag>;
  }
  // SplitText rewrites the heading's DOM into per-letter spans, so React can't patch new text into it.
  // Keying on the text remounts (and replays) the reveal when a data-driven heading changes.
  const textKey = [lead, accent].every((x) => x == null || typeof x === "string" || typeof x === "number")
    ? `${lead}|${accent ?? ""}`
    : undefined;
  return (
    <RevealText key={textKey} as={as} onScroll={onScroll} className={classes}>
      {content}
    </RevealText>
  );
}

/** Top of an app screen: eyebrow, giant two-line headline, lede and actions. */
export function PageHeader({
  eyebrow,
  lead,
  accent,
  inline,
  size = "2",
  lede,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  lead: ReactNode;
  accent?: ReactNode;
  inline?: boolean;
  size?: keyof typeof HEADLINE_SIZE;
  lede?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-5 pt-4 pb-6 md:pt-8", className)}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Headline as="h1" size={size} lead={lead} accent={accent} inline={inline} />
      {(lede || actions) && (
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          {lede && <p className="max-w-2xl text-[15px] leading-relaxed text-fg-2">{lede}</p>}
          {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
        </div>
      )}
    </header>
  );
}
