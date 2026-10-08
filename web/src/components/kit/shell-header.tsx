// The AppShell's sticky header. It takes on the tone of whatever section is scrolling under it
// (any element with data-tone="light" | "dark"), so it reads right over bone, ink, volt or forest.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "light" | "dark";

export function ShellHeader({ tone, children }: { tone: Tone; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [under, setUnder] = useState<Tone>(tone);

  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const y = header.getBoundingClientRect().bottom + 1;
      const below = document.elementFromPoint?.(window.innerWidth / 2, y);
      const found = below?.closest<HTMLElement>("[data-tone]")?.dataset.tone;
      setUnder(found === "light" || found === "dark" ? found : tone);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [tone]);

  return (
    <header
      ref={ref}
      className={cn(
        "sticky top-0 z-40 border-b border-line backdrop-blur-md backdrop-saturate-150 transition-[background-color,color] duration-300",
        under === "dark" ? "dark bg-brand-ink/70 text-brand-bone" : "light bg-brand-bone/75 text-brand-ink",
      )}
    >
      {children}
    </header>
  );
}
