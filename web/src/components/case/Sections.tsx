import { useQuery } from '@tanstack/react-query'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money } from '@/components/TierBadge'
import { api } from '@/lib/api'
import { AnimatedBar, CountUp } from '@/lib/motion'
import type { CaseDetail, EvidencePack } from '@/lib/types'
import type { CaseTimeline, Outlook } from '@/lib/types2'

// ---------------------------------------------------------------------------------------------- timeline
export function TimelineSection({ caseId }: { caseId: string }) {
  const q = useQuery<CaseTimeline>({ queryKey: ['timeline', caseId], queryFn: () => api(`/api/cases/${caseId}/timeline`) })
  if (q.isError) return <p className="text-sm text-muted-foreground">The timeline is not available for this case.</p>
  if (!q.data) return <p>Loading timeline…</p>
  const t = q.data
  const deaths = t.events.filter((e) => e.type === 'DEATH')
  const others = t.events.filter((e) => e.type !== 'DEATH')
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Billing trend for {t.primary}: <strong>{t.trend.label}</strong>. Bars show total paid per month; the line shows dollars on flagged lines.
      </p>
      <div className="surface h-64 p-2" role="img" aria-label="Monthly paid and flagged dollars">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={t.months} margin={{ left: 4, right: 8 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.3} />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={2} />
            <YAxis tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} width={46} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => money(Number(v))} />
            <Legend />
            <Bar dataKey="paid" name="Paid" fill="var(--muted-foreground)" fillOpacity={0.45} radius={2} />
            <Line dataKey="flaggedDollars" name="Flagged" stroke="var(--tier-high)" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className="text-sm" open={others.length + deaths.length <= 12}>
        <summary className="cursor-pointer">Recorded events ({t.events.length})</summary>
        <ol className="mt-2 space-y-0.5">
          {others.map((e, i) => <li key={`o${i}`}><span className="mono text-xs">{e.date}</span> · {e.label}</li>)}
          {deaths.length > 0 && <li><span className="mono text-xs">{deaths[0].date}</span> · {deaths.length} members have a recorded date of death</li>}
        </ol>
      </details>
    </div>
  )
}

// ----------------------------------------------------------------------------------------------- outlook
const HORIZONS = ['30', '60', '90'] as const

export function OutlookSection({ outlook }: { outlook: Outlook }) {
  if (!outlook.available || !outlook.horizons) {
    return <p className="text-sm">No outlook for this case{outlook.reason ? `: ${outlook.reason}` : ''}. The tier and the evidence do not depend on it.</p>
  }
  const o = outlook
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {HORIZONS.map((h) => {
          const x = o.horizons![h]
          const pct = Math.round(x.probability * 100)
          return (
            <div key={h} className="surface space-y-2 p-3" aria-label={`${h}-day outlook`}>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Next {h} days</p>
              <p className="text-3xl font-semibold"><CountUp value={pct} format={(n) => `${Math.round(n)}%`} /></p>
              <div className="h-2 rounded bg-muted" role="presentation"><AnimatedBar value={x.probability} className="bg-gradient-to-r from-indigo-500 to-teal-400" /></div>
              <p className="text-xs text-muted-foreground">chance of further flagged billing for {x.provider}</p>
              <ul className="list-disc pl-4 text-xs">
                {x.factors.map((f) => <li key={f.feature ?? f.label}>{f.label ?? f.feature}: {f.direction}</li>)}
              </ul>
            </div>
          )
        })}
      </div>
      <p className="text-sm">
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
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Why this tier</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {detail.tierReasons.map((r) => <li key={r.id}><span className="mono text-xs">{r.id}</span> {r.text}</li>)}
        </ul>
        <h3 className="pt-2 text-sm font-medium">Strength of each kind of evidence</h3>
        <ul className="space-y-1.5">
          {Object.entries(CHANNELS).map(([k, label]) => {
            const v = ch[k] ?? 0
            return (
              <li key={k} className="text-sm">
                <div className="flex justify-between"><span>{label}</span><span className="num">{v.toFixed(2)}</span></div>
                <div className="h-1.5 rounded bg-muted" role="presentation"><AnimatedBar value={v} className="bg-gradient-to-r from-indigo-500 to-teal-400" /></div>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">What the ranking weighs</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt>Risk</dt><dd className="num">{f.risk.toFixed(2)}</dd>
          <dt>Dollar score</dt><dd className="num">{f.dollarScore.toFixed(2)}</dd>
          <dt>Member impact</dt><dd className="num">{f.memberImpact.toFixed(2)}</dd>
          <dt>Severity</dt><dd className="num">{f.severity.toFixed(2)}</dd>
          <dt>Evidence strength</dt><dd className="num">{f.evidenceStrength.toFixed(2)}</dd>
        </dl>
        <h3 className="pt-2 text-sm font-medium">Limits of this analysis</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {(pack?.limitations ?? []).map((l) => <li key={l.id}><span className="mono text-xs">{l.id}</span> {l.text}</li>)}
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
  if (!q.data) return <p>Loading precedents…</p>
  if (q.data.length === 0) return <p className="text-sm">No closed case is similar enough to count as a precedent for this case.</p>
  return (
    <ul className="space-y-2">
      {q.data.map((p) => (
        <li key={p.precedentId} className="surface space-y-1 p-3 text-sm">
          <p>
            <span className="mono">{p.precedentId}</span> · similarity <strong className="num">{p.similarity.toFixed(2)}</strong> · closed{' '}
            <strong>{p.disposition}</strong>{p.reasonCode ? ` (${p.reasonCode})` : ''}{p.source === 'LIVE' ? ' · added by a reviewer' : ' · seed'}
          </p>
          {p.rationale && <p className="text-muted-foreground">{p.rationale}</p>}
          {compareLines(p.compare).length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs">Why it is similar</summary>
              <ul className="list-disc pl-5 text-xs">{compareLines(p.compare).map((l) => <li key={l}>{l}</li>)}</ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  )
}
