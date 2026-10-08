// The Lab: Allotiq's "same requests, different solvers" page, rebuilt for ClaimShield. It shows how each detector and
// the 30/60/90-day outlook performed against synthetic ground truth. Every figure is read from the engine's evaluation
// report for the current run; nothing here is typed in. The basis line is always shown.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Eyebrow, KpiBand, Panel, Reveal, ScoreReceipt, Section, StatusBadge, Tag } from '@/components/kit'
import { PageHeader } from '@/components/kit/section'
import { api } from '@/lib/api'
import type { EvalReport } from '@/lib/types2'
import { cn } from '@/lib/utils'

const CHANNEL: Record<string, string> = { LINE: 'Claim lines', PEER: 'Peers', SELF: 'Own history', NETWORK: 'Relationships' }
const RULE_NAME: Record<string, string> = {
  'R-DUP-01': 'Duplicate billing', 'R-PTP-01': 'Unbundled procedure pairs', 'R-MUE-01': 'Units over limits', 'R-DOD-01': 'Services after death',
  'R-EXCL-01': 'Excluded provider', 'R-DME-01': 'Equipment without a visit', 'R-TIME-01': 'Impossible timing', 'R-GEO-01': 'Impossible travel',
  'R-IP-01': 'Billed during an inpatient stay', 'S-UPC': 'Visit levels above peers', 'S-UTL': 'Utilisation above peers', 'S-GHOST': 'Unusual care pattern',
  'G-OWNREF': 'Owner-driven referrals', 'G-LOOP': 'Referral loops', 'G-REFCONC': 'Referral concentration', 'G-INFRA': 'Shared infrastructure',
}

const pct = (v: number | null | undefined) => (v == null ? 'n/a' : `${Math.round(v * 100)}%`)

function metric(m: unknown, key: string): number | null {
  const v = (m as Record<string, unknown> | undefined)?.[key]
  return typeof v === 'number' ? v : null
}

export function LabPage() {
  const q = useQuery<EvalReport>({ queryKey: ['eval'], queryFn: () => api('/api/eval') })
  const [h, setH] = useState('30')
  if (q.isError) return <p className="text-sm text-muted-foreground">The evaluation report is not available for this run.</p>
  if (!q.data) return <div className="h-96 animate-pulse rounded-2xl bg-muted" />
  const e = q.data
  const rules = [...e.rules].sort((a, b) => a.channel.localeCompare(b.channel) || a.rule.localeCompare(b.rule))
  const horizon = e.prediction.horizons[h]
  const test = horizon?.test as { metrics?: Record<string, Record<string, number>>; beatsPersistence?: boolean; liftOverBestPersistence?: number } | undefined
  const model = test?.metrics?.model
  const base = test?.metrics?.persistence_last_month
  const flaggedSchemes = e.decoyProviders.length

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="The Lab · evaluation"
        lead="Same data."
        accent="Honest numbers."
        lede="Each detector and the 30, 60 and 90 day outlook, measured against synthetic ground truth that the detectors never see. Recall is exact; precision is a lower bound; none of this is real-world accuracy."
        actions={<Tag className="bg-volt text-brand-ink">synthetic basis</Tag>}
      />

      <p role="note" className="rounded-2xl border bg-card px-4 py-3 text-sm text-fg-2">{e.basis}.</p>

      <Reveal onScroll>
        <KpiBand
          tone="forest"
          items={[
            { label: 'detectors measured', value: rules.length },
            { label: 'of positive dollars in cases that fit capacity', value: Math.round(e.coverage.pct * 100), unit: '%' },
            { label: 'decoy lines falsely flagged', value: e.decoys.falselyFlagged, total: e.decoys.lines },
            { label: 'scheme providers caught by the temporal detector', value: e.temporal.detected, total: e.temporal.schemeProviders },
          ]}
        />
      </Reveal>

      {/* detectors */}
      <Section tone="bone" className="rounded-[1.75rem]" inner="py-12 px-6 md:px-10">
        <Eyebrow index="01">Detectors</Eyebrow>
        <h2 className="display-3 mt-4 text-fg">What each rule found</h2>
        <div className="mt-8 grid gap-3">
          {rules.map((r) => (
            <div key={r.rule} className="grid items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-line md:grid-cols-[14rem_1fr_9rem]">
              <div>
                <p className="font-semibold text-fg">{RULE_NAME[r.rule] ?? r.rule}</p>
                <p className="mono text-xs text-fg-3">{r.rule} · {CHANNEL[r.channel] ?? r.channel}</p>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[11px] text-fg-3"><span>recall</span><span className="text-fg">{pct(r.recall)}</span></div>
                <div className="relative h-1.5 overflow-hidden rounded-full bg-viz-track"><span className="absolute inset-y-0 left-0 rounded-full bg-viz-1" style={{ width: `${(r.recall ?? 0) * 100}%` }} /></div>
                <div className="flex justify-between font-mono text-[11px] text-fg-3"><span>precision, lower bound</span><span className="text-fg">{pct(r.precisionLowerBound)}</span></div>
                <div className="relative h-1.5 overflow-hidden rounded-full bg-viz-track"><span className="absolute inset-y-0 left-0 rounded-full bg-viz-2" style={{ width: `${(r.precisionLowerBound ?? 0) * 100}%` }} /></div>
              </div>
              <p className="text-right font-mono text-xs text-fg-2">{r.truePositives ?? '-'} of {r.positives} found<br /><span className="text-fg-3">{r.flagged} flagged</span></p>
            </div>
          ))}
        </div>
        {e.rules.some((r) => r.positives === 0) && <p className="mt-4 text-xs text-fg-3">Rules with no injected positives in this run show n/a.</p>}
      </Section>

      {/* ring and decoys */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel tone="ink" className="space-y-4 p-7">
          <Eyebrow index="02">Decoys</Eyebrow>
          <p className="display-4 text-fg">Look-alikes that are legitimate</p>
          <p className="text-sm text-fg-2">Providers built to look unusual for innocent reasons. They may be flagged weakly; they must never reach HIGH.</p>
          <ul className="space-y-2">
            {e.decoyProviders.map((d) => (
              <li key={d.scheme} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="mono text-xs text-fg-3">{d.type}</span>
                <span className="text-fg">{d.providers.join(', ')}</span>
                <StatusBadge status={d.reachedHigh ? 'REJECTED' : 'CLOSED'} />
                <span className="text-fg-3">{d.reachedHigh ? 'reached HIGH' : d.bestTier ? `best tier ${d.bestTier.toLowerCase()}` : 'not flagged'}</span>
              </li>
            ))}
            {flaggedSchemes === 0 && <li className="text-sm text-fg-3">No decoy providers in this run.</li>}
          </ul>
        </Panel>
        <Panel tone="ink" className="space-y-4 p-7">
          <Eyebrow index="03">Relationships</Eyebrow>
          <p className="display-4 text-fg">Was the ring found?</p>
          <p className="figure text-[4rem] text-fg">{e.network.ringRecovered ? 'Yes' : 'No'}</p>
          <p className="text-sm text-fg-2">The injected ring of {e.network.ringProviders.length} providers fell into {e.network.casesPerRing} case(s). Temporal detector: median delay {e.temporal.medianDelayMonths} month(s), {e.temporal.falseAlarmsPer1000ProviderMonths} false alarms per 1,000 provider-months.</p>
        </Panel>
      </div>

      {/* outlook */}
      {e.prediction.available && (
        <Section tone="white" className="rounded-[1.75rem]" inner="py-12 px-6 md:px-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <Eyebrow index="04">Outlook model</Eyebrow>
              <h2 className="display-3 mt-4 text-fg">30, 60 and 90 days</h2>
            </div>
            <div role="tablist" aria-label="Horizon" className="flex gap-2">
              {Object.keys(e.prediction.horizons).map((k) => (
                <button key={k} role="tab" aria-selected={h === k} onClick={() => setH(k)}
                  className={cn('rounded-full px-4 py-1.5 font-mono text-xs ring-1 ring-line transition', h === k ? 'bg-brand-ink text-brand-bone' : 'hover:bg-sunken')}>{k} days</button>
              ))}
            </div>
          </div>
          <p className="mt-4 max-w-3xl text-sm text-fg-2">
            A ranking score on a synthetic future-risk target, evaluated on held-out providers and later months. It is compared with simple
            persistence baselines; it is never evidence about a provider.
          </p>
          {horizon && (
            <div className="mt-8 grid gap-8 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2"><Tag>chosen: {horizon.chosen === 'hgb' ? 'gradient boosting' : 'logistic regression'}</Tag>
                  {test?.beatsPersistence != null && <Tag className={test.beatsPersistence ? 'bg-volt text-brand-ink' : ''}>{test.beatsPersistence ? 'beats persistence' : 'does not beat persistence'}</Tag>}</div>
                <ScoreReceipt
                  rows={[
                    { key: 'pr', label: 'PR-AUC, model', value: metric(model, 'prAuc') ?? 0, weight: 1 },
                    { key: 'prb', label: 'PR-AUC, last-month baseline', value: metric(base, 'prAuc') ?? 0, weight: 1 },
                    { key: 'roc', label: 'ROC-AUC, model', value: metric(model, 'rocAuc') ?? 0, weight: 1 },
                    { key: 'p10', label: 'Precision in the top tenth', value: metric(model, 'precisionAtTopDecile') ?? 0, weight: 1 },
                  ]}
                  total={metric(model, 'prAuc') ?? 0}
                  caption="PR-AUC on held-out providers"
                />
                <p className="text-xs text-fg-3">Prevalence in the test set: {pct(metric(model, 'prevalence'))}. Wide intervals are normal with {String((horizon.rows as { test?: number }).test ?? '?')} test rows.</p>
              </div>
              <div className="space-y-3">
                <p className="eyebrow text-fg-3">What moved the ranking</p>
                {horizon.importance.slice(0, 6).map((f) => {
                  const top = horizon.importance[0]?.importance || 1
                  return (
                    <div key={f.feature} className="space-y-1">
                      <div className="flex justify-between text-[13px]"><span className="text-fg-2">{(f as { label?: string }).label ?? f.feature}</span><span className="mono text-xs text-fg">{f.importance.toFixed(3)}</span></div>
                      <div className="relative h-1.5 overflow-hidden rounded-full bg-viz-track"><span className="absolute inset-y-0 left-0 rounded-full bg-viz-4" style={{ width: `${Math.max(2, (f.importance / top) * 100)}%` }} /></div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </Section>
      )}

      <section aria-label="Notes" className="space-y-2 text-sm text-fg-3">
        <p className="eyebrow">Notes</p>
        <ul className="list-disc space-y-1 pl-5">{e.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        <p>Back to <Link className="underline" to="/queue">the SIU queue</Link>.</p>
      </section>
    </div>
  )
}
