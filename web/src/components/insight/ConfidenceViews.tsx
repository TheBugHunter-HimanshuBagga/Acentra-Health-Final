import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProvChip } from '@/components/Provenance'
import { money } from '@/components/TierBadge'
import { AnimatedBar, CountUp } from '@/lib/motion'
import type { ConfidenceBlock, ImpactBlock, ReasoningStep } from '@/lib/types2'

const LEVEL_TONE: Record<string, string> = {
  HIGH: 'text-[var(--tier-high)]',
  MEDIUM: 'text-[var(--tier-medium)]',
  LOW: 'text-[var(--tier-monitor)]',
}
const CHANNELS = ['LINE', 'PEER', 'SELF', 'NETWORK'] as const
const CHANNEL_NAME: Record<string, string> = { LINE: 'Claim lines', PEER: 'Peers', SELF: 'Own history', NETWORK: 'Network' }

/** Risk and confidence are shown apart on purpose: risk is how much attention a case deserves, confidence is how sure we are. */
export function Triad({ c }: { c: ConfidenceBlock }) {
  const { t } = useTranslation()
  const low = c.level === 'LOW'
  return (
    <section aria-labelledby="triad-h" className="@container space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">{t('triad.eyebrow', 'Risk, evidence and confidence')}</p>
          <h2 id="triad-h" className="text-xl font-semibold">{t('triad.title', 'How sure are we, and why')}</h2>
        </div>
        <p className="max-w-md text-xs text-muted-foreground">{c.risk.note} {t('triad.rule', 'Confidence comes from evidence, never from the risk score.')}</p>
      </div>
      <div className="grid gap-px overflow-hidden rounded-[var(--radius)] border bg-border @3xl:grid-cols-3">
        {/* RISK */}
        <div className="space-y-3 bg-card p-5">
          <p className="eyebrow">{t('triad.risk', 'Risk')}</p>
          <p className="bignum text-5xl"><CountUp value={c.risk.score} format={(n) => n.toFixed(2)} /></p>
          <p className="text-xs text-muted-foreground">{t('triad.severity', 'Severity')} {c.risk.severity.toFixed(2)}</p>
          <ul className="space-y-1.5">
            {c.risk.drivers.map((d) => (
              <li key={d.channel} className="text-xs">
                <div className="flex justify-between"><span>{CHANNEL_NAME[d.channel] ?? d.channel}</span><span className="num">{d.contribution.toFixed(2)}</span></div>
                <div className="h-1 rounded bg-muted"><AnimatedBar value={Math.min(1, d.contribution)} className="bg-[var(--signal)]" /></div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
            <ProvChip kind="prediction" />
            {c.risk.outlook.available && c.risk.outlook.p90 != null
              ? <span className="num">{Math.round(c.risk.outlook.p90 * 100)}% · {t('triad.outlook', '90-day outlook, a ranking score')}</span>
              : <span className="text-muted-foreground">{t('triad.noOutlook', 'No outlook for this case')}</span>}
          </div>
        </div>

        {/* EVIDENCE */}
        <div className="space-y-3 bg-card p-5">
          <p className="eyebrow">{t('triad.evidence', 'Evidence')}</p>
          <p className="bignum text-5xl"><CountUp value={c.evidence.strength} format={(n) => n.toFixed(2)} /></p>
          <p className="text-xs text-muted-foreground">{t('triad.strength', 'Evidence strength')} · {c.evidence.count} {t('triad.items', 'evidence items')}</p>
          <ul className="flex flex-wrap gap-1.5" aria-label={t('triad.channels', 'Independent channels')}>
            {CHANNELS.map((ch) => {
              const on = c.evidence.channelsAgreeing.includes(ch)
              return (
                <li key={ch} className={`chip ${on ? 'chip-corr' : ''}`} aria-label={`${CHANNEL_NAME[ch]} ${on ? 'agrees' : 'does not agree'}`}>
                  {CHANNEL_NAME[ch]}
                </li>
              )
            })}
          </ul>
          <dl className="grid grid-cols-2 gap-2 border-t pt-3 text-xs">
            <div><dt className="eyebrow">{t('triad.supporting', 'Supporting')}</dt><dd className="bignum text-2xl">{c.evidence.supporting.length}</dd></div>
            <div><dt className="eyebrow">{t('triad.contradicting', 'Conflicting')}</dt><dd className="bignum text-2xl">{c.evidence.contradicting.length}</dd></div>
          </dl>
          <p className="mono text-[0.65rem] text-muted-foreground">{c.evidence.evidenceIds.join(' · ')}</p>
        </div>

        {/* CONFIDENCE */}
        <div className="space-y-3 bg-card p-5">
          <p className="eyebrow">{t('triad.confidence', 'Confidence')}</p>
          <p className={`bignum text-5xl ${LEVEL_TONE[c.level]}`}>{c.level}</p>
          <p className="text-sm">{low ? c.insufficientText : c.statement}</p>
          <p className="rounded-md border p-2 text-xs"><span className="eyebrow mr-1">{t('triad.route', 'Route')}</span>{c.route.text}</p>
          {c.evidence.contradicting.length > 0 && (
            <div className="space-y-1">
              <p className="eyebrow">{t('triad.conflicts', 'What argues the other way')}</p>
              <ul className="list-disc space-y-1 pl-4 text-xs">{c.evidence.contradicting.map((x) => <li key={x.id}><span className="mono">{x.id}</span> {x.text}</li>)}</ul>
            </div>
          )}
          {c.evidence.missing.length > 0 && (
            <div className="space-y-1">
              <p className="eyebrow">{low ? t('triad.missingNeeded', 'Missing evidence required') : t('triad.missing', 'What would raise confidence')}</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{c.evidence.missing.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** Every impact number comes with "Why do we believe this?": the evidence ids, the source fields and whether it is exact. */
export function ImpactGrid({ impact }: { impact: ImpactBlock }) {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="impact-h" className="@container space-y-4">
      <div>
        <p className="eyebrow">{t('impact.eyebrow', 'Who and what is affected')}</p>
        <h2 id="impact-h" className="text-xl font-semibold">{t('impact.title', 'Case impact')}</h2>
      </div>
      <ul className="grid gap-px overflow-hidden rounded-[var(--radius)] border bg-border @md:grid-cols-2 @4xl:grid-cols-4">
        {impact.items.map((i) => (
          <li key={i.id} className="space-y-2 bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="eyebrow">{i.label}</p>
              <span className={`chip ${i.basis === 'EXACT' ? 'chip-fact' : i.basis === 'ESTIMATED' ? 'chip-pred' : 'chip-signal'}`}>{i.basis.toLowerCase()}</span>
            </div>
            <p className="bignum text-3xl">{i.display}</p>
            <details className="group text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none hover:text-foreground">{t('impact.why', 'Why do we believe this?')}</summary>
              <p className="mt-2 text-foreground">{i.why}</p>
              <p className="mono mt-2 text-[0.65rem]">{i.id} · {i.evidenceIds.join(', ') || 'no evidence item'}</p>
              <p className="mono mt-1 text-[0.65rem]">{i.sourceFields.join(', ')}</p>
            </details>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        {t('impact.severity', 'Severity')} <strong className="num text-foreground">{impact.severity.value.toFixed(2)}</strong>: {impact.severity.why}
        {' '}{t('impact.basis', 'Exposure basis')}: <strong className="text-foreground">{impact.exposureBasis.toLowerCase()}</strong>
        {impact.exposureBasis === 'MIXED' && ` (${money(impact.items.find((i) => i.key === 'exposureExact')?.value ?? 0)} exact, ${money(impact.items.find((i) => i.key === 'exposureEstimated')?.value ?? 0)} estimated, never added without the label)`}.
      </p>
    </section>
  )
}

/** RETRIEVE, INTERPRET, APPLY RULES, PROPOSE, SCORE, CITE, HUMAN REVIEW: the path from data to a recommendation, step by step. */
export function ReasoningChain({ steps, note }: { steps: ReasoningStep[]; note: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(steps[0]?.id ?? '')
  const cur = steps.find((s) => s.id === open) ?? steps[0]
  return (
    <section aria-labelledby="chain-h" className="@container space-y-4">
      <div>
        <p className="eyebrow">{t('chain.eyebrow', 'How the system got here')}</p>
        <h2 id="chain-h" className="text-xl font-semibold">{t('chain.title', 'Reasoning chain')}</h2>
      </div>
      <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] border bg-border @lg:grid-cols-4 @3xl:grid-cols-7" aria-label={t('chain.title', 'Reasoning chain')}>
        {steps.map((s, i) => (
          <li key={s.id} className="bg-card">
            <button
              type="button"
              aria-pressed={s.id === open}
              onClick={() => setOpen(s.id)}
              className={`h-full w-full p-3 text-left hover:bg-muted ${s.id === open ? 'bg-muted shadow-[inset_0_-2px_0_var(--signal)]' : ''}`}
            >
              <span className="eyebrow">{String(i + 1).padStart(2, '0')}</span>
              <span className="mt-1 block text-xs font-medium leading-tight">{s.step.replace('_', ' ')}</span>
            </button>
          </li>
        ))}
      </ol>
      {cur && (
        <div className="panel space-y-3 p-5" role="region" aria-label={cur.title}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono text-xs">{cur.id}</span>
            <span className="chip chip-signal">{cur.step.replace('_', ' ')}</span>
          </div>
          <p className="text-[0.95rem] leading-relaxed">{cur.summary}</p>
          {cur.details.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{cur.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
          {cur.refs.length > 0 && <p className="mono flex flex-wrap gap-1 text-[0.65rem] text-muted-foreground">{cur.refs.map((r) => <span key={r} className="rounded border px-1.5 py-0.5">{r}</span>)}</p>}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{note}</p>
    </section>
  )
}
