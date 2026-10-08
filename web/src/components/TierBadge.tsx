import type { Tier } from '@/lib/types'

/** Tier is always conveyed by a glyph AND a word, never by colour alone. */
const GLYPH: Record<Tier, string> = { HIGH: '▲', MEDIUM: '◆' }
const TONE: Record<Tier, string> = {
  HIGH: 'text-[var(--tier-high)] border-[color-mix(in_oklab,var(--tier-high)_45%,transparent)] bg-[color-mix(in_oklab,var(--tier-high)_10%,transparent)]',
  MEDIUM: 'text-[var(--tier-medium)] border-[color-mix(in_oklab,var(--tier-medium)_45%,transparent)] bg-[color-mix(in_oklab,var(--tier-medium)_10%,transparent)]',
}

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      aria-label={`${tier} confidence`}
      className={`mono inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.65rem] font-medium tracking-[0.12em] ${TONE[tier]}`}
    >
      <span aria-hidden="true">{GLYPH[tier]}</span> {tier}
    </span>
  )
}

export const money = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
