import { Badge } from '@/components/ui/badge'
import type { Tier } from '@/lib/types'

/** Tier is always conveyed by a glyph AND a word, never by colour alone. */
const GLYPH: Record<Tier, string> = { HIGH: '▲', MEDIUM: '◆' }

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <Badge variant={tier === 'HIGH' ? 'destructive' : 'secondary'} aria-label={`${tier} confidence`}>
      <span aria-hidden="true">{GLYPH[tier]}</span> {tier}
    </Badge>
  )
}

export const money = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
