import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ProvChip } from '@/components/Provenance'
import { money } from '@/components/TierBadge'
import { api } from '@/lib/api'
import { AnimatedBar, CountUp } from '@/lib/motion'
import type { CaseDetail, EvidencePack } from '@/lib/types'
import type { CaseTimeline, Outlook } from '@/lib/types2'

const tip = { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }

// ---------------------------------------------------------------------------------------------- timeline
export function TimelineSection({ caseId }: { caseId: string }) {
  const q = useQuery<CaseTimeline>({ queryKey: ['timeline', caseId], queryFn: () => api(`/api/cases/${caseId}/timeline`) })
  if (q.isError) return <p className="text-sm text-muted-foreground">The timeline is not available for this case.</p>
  if (!q.data) return <div className="h-64 animate-pulse rounded-lg bg-muted" />
  const t = q.data
  const months = new Set(t.months.map((m) => m.month))
  const deaths = t.events.filter((e) => e.type === 'DEATH')
  const others = t.events.filter((e) => e.type !== 'DEATH')
  const markers = Array.from(new Set(t.events.filter((e) => e.type !== 'ENROLLED').map((e) => e.date.slice(0, 7)))).filter((m) => months.has(m)).slice(0, 8)
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Billing trend for {t.primary}: <strong>{t.trend.label}</strong>. Bars show total paid per month; the line shows dollars on flagged lines; dashed
        markers are recorded events.
      </p>
      <div className="h-72" role="img" aria-label="Monthly paid and flagged dollars">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={t.months} margin={{ left: 4, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.25} />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} interval={2} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} width={46} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tip} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} formatter={(v) => money(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {markers.map((m) => <ReferenceLine key={m} x={m} stroke="var(--warn)" strokeDasharray="3 4" strokeOpacity={0.8} />)}
            <Bar dataKey="paid" name="Paid" fill="var(--muted-foreground)" fillOpacity={0.35} radius={[3, 3, 0, 0]} animationDuration={1200} />
            <Line dataKey="flaggedDollars" name="Flagged" stroke="var(--tier-high)" strokeWidth={2.5} dot={false} animationDuration={1600} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className="text-sm" open={others.length + deaths.length <= 12}>
        <summary className="eyebrow cursor-pointer">Recorded events ({t.events.length})</summary>
        <ol className="mt-3 space-y-1.5 border-l pl-4">
          {others.map((e, i) => <li key={`o${i}`}><span className="mono text-xs text-muted-foreground">{e.date}</span> · {e.label}</li>)}
          {deaths.length > 0 && <li><span className="mono text-xs text-muted-foreground">{deaths[0].date}</span> · {deaths.length} members have a recorded date of death</li>}
        </ol>
      </details>
    </div>
  )
}

// ----------------------------------------------------------------------------------------------- outlook
const HORIZONS = ['30', '60', '90'] as const

/** A prediction, never proof: hatched meters, an explicit label and the validation caveat travel with every number. */
export function OutlookSection({ outlook }: { outlook: Outlook }) {
  const { t } = useTranslation()
  if (!outlook.available || !outlook.horizons) {
    return <p className="text-sm">No outlook for this case{outlook.reason ? `: ${outlook.reason}` : ''}. The tier and the evidence do not depend on it.</p>
  }
  const o = outlook
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{t('outlook.disclaimer')}</p>
      <ol className="divide-y border-y">
        {HORIZONS.map((h) => {
          const x = o.horizons![h]
          const pct = Math.round(x.probability * 100)
          return (
            <li key={h} className="space-y-2 py-3" aria-label={`${h}-day outlook`}>
              <div className="flex items-baseline justify-between">
                <span className="eyebrow">{t('outlook.days', { n: h })}</span>
                <span className="bignum text-3xl"><CountUp value={pct} format={(n) => `${Math.round(n)}%`} /></span>
              </div>
              <div className="h-1.5 rounded bg-muted [background-image:repeating-linear-gradient(135deg,transparent_0_4px,color-mix(in_oklab,var(--muted-foreground)_18%,transparent)_4px_5px)]" role="presentation">
                <AnimatedBar value={x.probability} className="bg-[var(--muted-foreground)]/70" />
              </div>
              <p className="text-xs text-muted-foreground">{t('outlook.ranking')} for further flagged billing · {x.provider}</p>
              <ul className="flex flex-wrap gap-1.5">
                {x.factors.map((f) => <li key={f.feature ?? f.label} className="chip chip-signal !whitespace-normal normal-case tracking-normal">{f.label ?? f.feature}{f.direction ? ` · ${f.direction}` : ''}</li>)}
              </ul>
            </li>
          )
        })}
      </ol>
      <p className="text-xs text-muted-foreground">
        {o.beatsPersistence
          ? 'On held-out providers and later months this model ranked better than the simple "any hit recently" baseline.'
          : 'On held-out providers and later months this model did not clearly beat the simple "any hit recently" baseline, so treat it as a tie-breaker only.'}
        {typeof o.liftOverBestPersistence === 'number' && ` Lift over the best baseline: ${o.liftOverBestPersistence.toFixed(2)}.`}
      </p>
      <p className="text-xs text-muted-foreground">
        These percentages are a ranking score, not calibrated chances: on held-out data the model was more confident than the outcomes justified, and its advantage over the simple baseline was small and not statistically clear. Use it to order work, never as proof.
      </p>
      {o.caveat && <p className="text-xs text-muted-foreground">{o.caveat}</p>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------- confidence
const CHANNELS: Record<string, string> = {
  LINE: 'Claim lines (recorded facts and rules)',
  PEER: 'Comparison with similar providers',
  SELF: "The provider's own history",
  NETWORK: 'Links between providers',
}

export function ConfidenceSection({ detail, pack }: { detail: CaseDetail; pack?: EvidencePack }) {
  const ch = detail.channels ?? {}
  const f = detail.factors
  const agree = Object.values(ch).filter((v) => v >= 0.65).length
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">Independent evidence channels</h3>
          {agree >= 2 && <ProvChip kind="corroboration" />}
        </div>
        <ul className="space-y-2">
          {Object.entries(CHANNELS).map(([k, label]) => {
            const v = ch[k] ?? 0
            return (
              <li key={k} className="text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span className="num">{v.toFixed(2)}</span></div>
                <div className="mt-1 h-1 rounded bg-muted" role="presentation"><AnimatedBar value={v} className={v >= 0.65 ? 'bg-[var(--warn)]' : 'bg-[var(--signal)]'} /></div>
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-muted-foreground">A case reaches HIGH only when a recorded fact and at least one other channel agree, or three channels agree.</p>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">What the ranking weighs</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Risk</dt><dd className="num text-right">{f.risk.toFixed(2)}</dd>
          <dt className="text-muted-foreground">Dollar score</dt><dd className="num text-right">{f.dollarScore.toFixed(2)}</dd>
          <dt className="text-muted-foreground">Member impact</dt><dd className="num text-right">{f.memberImpact.toFixed(2)}</dd>
          <dt className="text-muted-foreground">Severity</dt><dd className="num text-right">{f.severity.toFixed(2)}</dd>
          <dt className="text-muted-foreground">Evidence strength</dt><dd className="num text-right">{f.evidenceStrength.toFixed(2)}</dd>
        </dl>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Limits of this analysis</h3>
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          {(pack?.limitations ?? []).map((l) => <li key={l.id}><span className="mono">{l.id}</span> {l.text}</li>)}
        </ul>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------- precedents
interface CasePrecedentRow {
  precedentId: string
  similarity: number
  disposition: string
  reasonCode: string | null
  source: string | null
  schemeType: string | null
  rationale: string | null
  compare: unknown
}

function compareLines(c: unknown): string[] {
  if (Array.isArray(c)) {
    return c.slice(0, 6).map((x) => (typeof x === 'object' && x ? Object.entries(x as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join(', ') : String(x)))
  }
  if (c && typeof c === 'object') {
    return Object.entries(c as Record<string, unknown>).slice(0, 6).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  }
  return []
}

export function PrecedentsSection({ caseId }: { caseId: string }) {
  const q = useQuery<CasePrecedentRow[]>({ queryKey: ['case-precedents', caseId], queryFn: () => api(`/api/cases/${caseId}/precedents`) })
  if (q.isError) return <p className="text-sm text-muted-foreground">Precedents are not available for this case.</p>
  if (!q.data) return <div className="h-16 animate-pulse rounded-lg bg-muted" />
  if (q.data.length === 0) return <p className="text-sm">No closed case is similar enough to count as a precedent for this case.</p>
  return (
    <ul className="space-y-3">
      {q.data.map((p) => (
        <li key={p.precedentId} className="panel space-y-2 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono text-xs">{p.precedentId}</span>
            <span className="chip chip-human">closed {p.disposition}</span>
            <span className="eyebrow">{p.source === 'LIVE' ? 'added by a reviewer' : 'seed'}</span>
            <span className="ml-auto flex items-center gap-2" title="Similarity of the case profiles">
              <span className="h-1 w-16 rounded bg-muted"><AnimatedBar value={p.similarity} className="bg-[var(--signal)]" /></span>
              <span className="num text-xs">{p.similarity.toFixed(2)}</span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">similarity {p.similarity.toFixed(2)}{p.reasonCode ? ` · ${p.reasonCode}` : ''}</p>
          {p.rationale && <p>{p.rationale}</p>}
          {compareLines(p.compare).length > 0 && (
            <details>
              <summary className="eyebrow cursor-pointer">Why it is similar</summary>
              <ul className="mt-2 list-disc pl-5 text-xs">{compareLines(p.compare).map((l) => <li key={l}>{l}</li>)}</ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  )
}
