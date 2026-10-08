import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProvChip } from '@/components/Provenance'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import type { Me } from '@/lib/types'
import type { Explanation, ReasoningOutput } from '@/lib/types2'

const SECTION_LABEL: Record<string, string> = {
  headline: 'Summary',
  why: 'Why it was flagged',
  supporting: 'Supporting signals',
  conflicting: 'Conflicting signals',
  confidenceExplanation: 'What the confidence means',
  missingEvidence: 'What is missing',
  investigatorQuestions: 'Questions to ask',
  nextEvidence: 'Evidence to collect next',
}
const ORDER = Object.keys(SECTION_LABEL)

const fmt = (o: Record<string, unknown> | null | undefined) =>
  o ? Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : Array.isArray(v) ? v.join(', ') : String(v)}`).join(' · ') : ''

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b py-3 md:grid-cols-[11rem_1fr] md:gap-4">
      <dt className="eyebrow pt-0.5">{label}</dt>
      <dd className="space-y-1 text-sm">{children}</dd>
    </div>
  )
}

/** Why a case was flagged (or why a provider was not escalated), with every claim tied to evidence ids. */
export function ExplanationCard({ x }: { x: Explanation }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="display text-2xl leading-tight md:text-3xl">{x.headline}</p>
        <p className="text-sm font-medium">{x.confidenceLine}</p>
        {x.impactLine && <p className="text-sm text-muted-foreground">{x.impactLine}</p>}
      </div>
      <dl className="border-t">
        {x.flagged ? (
          <>
            {x.trigger && <Row label={t('why.trigger', 'Trigger')}><span className="mono mr-2 text-xs">{x.trigger.id}</span>{x.trigger.statement}</Row>}
            {x.strongestEvidence && <Row label={t('why.strongest', 'Strongest evidence')}><ProvChip kind={x.strongestEvidence.hardFact ? 'fact' : 'signal'} /> <span className="mono mx-2 text-xs">{x.strongestEvidence.id}</span>{x.strongestEvidence.statement}</Row>}
            {!!x.supportingEvidence?.length && <Row label={t('why.supporting', 'Supporting evidence')}><ul className="space-y-1">{x.supportingEvidence.map((e) => <li key={e.id}><span className="mono mr-2 text-xs">{e.id}</span>{e.statement}</li>)}</ul></Row>}
            {!!x.riskContribution?.length && (
              <Row label={t('why.risk', 'Risk contribution')}>
                <ul className="flex flex-wrap gap-x-5 gap-y-1">{x.riskContribution.map((c) => <li key={c.channel}><span className="text-muted-foreground">{c.channel.toLowerCase()}</span> <strong className="num">{Math.round(c.share * 100)}%</strong></li>)}</ul>
              </Row>
            )}
            {!!x.whyUnusual?.length && <Row label={t('why.unusual', 'Why it is unusual')}><ul className="list-disc space-y-1 pl-4">{x.whyUnusual.map((w) => <li key={w}>{w}</li>)}</ul></Row>}
            {!!x.peerComparison?.length && (
              <Row label={t('why.peers', 'Peer comparison')}>
                <ul className="space-y-1.5">{x.peerComparison.map((p) => (
                  <li key={p.id}><span className="mono mr-2 text-xs">{p.id}</span>observed <span className="mono text-xs">{fmt(p.observed)}</span> against peers <span className="mono text-xs">{fmt(p.peer)}</span><span className="block text-xs text-muted-foreground">threshold: {p.threshold}</span></li>
                ))}</ul>
              </Row>
            )}
            {!!x.historicalBehaviour?.length && <Row label={t('why.history', 'Historical behaviour')}><ul className="space-y-1">{x.historicalBehaviour.map((h) => <li key={h.id}><span className="mono mr-2 text-xs">{h.id}</span><span className="mono text-xs">{fmt(h.history)}</span></li>)}</ul></Row>}
            {!!x.networkContext?.length && <Row label={t('why.network', 'Network context')}><ul className="space-y-1">{x.networkContext.map((n) => <li key={n.id}><span className="mono mr-2 text-xs">{n.id}</span>{n.statement}</li>)}</ul></Row>}
            <Row label={t('why.contradictory', 'Contradictory evidence')}>
              {x.contradictory?.length ? <ul className="list-disc space-y-1 pl-4">{x.contradictory.map((c) => <li key={c.id}><span className="mono text-xs">{c.id}</span> {c.text}</li>)}</ul> : <span className="text-muted-foreground">{t('why.noContra', 'None was found in the evidence pack.')}</span>}
            </Row>
          </>
        ) : (
          <>
            <Row label={t('why.seen', 'What was seen')}><ul className="list-disc space-y-1 pl-4">{x.whatWasSeen?.map((s) => <li key={s}>{s}</li>)}</ul></Row>
            {!!x.reasons?.length && <Row label={t('why.notBecause', 'Why it stayed below a case')}><ul className="list-disc space-y-1 pl-4">{x.reasons.map((r) => <li key={r}>{r}</li>)}</ul></Row>}
            {x.viaException && <Row label={t('why.exception', 'Governed exception')}><span className="mono">{x.viaException}</span></Row>}
          </>
        )}
        <Row label={x.flagged ? t('why.missing', 'Missing evidence') : t('why.change', 'What would change this')}>
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground">{(x.flagged ? x.missingEvidence : x.whatWouldChangeThis ?? x.missingEvidence).map((m) => <li key={m}>{m}</li>)}</ul>
        </Row>
        <Row label={t('why.action', 'Recommended human action')}>
          <span className="chip chip-human mr-2">{x.recommendedHumanAction.action.replace(/_/g, ' ')}</span>{x.recommendedHumanAction.text}
        </Row>
      </dl>
    </div>
  )
}

/** The model's grounded explanation: validated against the pack, or the deterministic text when validation fails. */
export function AiReasoning({ caseId, me }: { caseId: string; me: Me }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const q = useQuery<ReasoningOutput>({ queryKey: ['reasoning', caseId], queryFn: () => api(`/api/cases/${caseId}/reasoning`) })
  const make = useMutation({
    mutationFn: (force: boolean) => api<ReasoningOutput>(`/api/cases/${caseId}/reasoning?force=${force}`, { method: 'POST' }),
    onSuccess: (r) => {
      setError(null)
      qc.setQueryData(['reasoning', caseId], { ...r, available: true })
    },
    onError: (e) => setError(e instanceof ApiError ? e.detail : t('common.error')),
  })
  const r = q.data
  const canMake = me.role !== 'AUDITOR'
  return (
    <div className="space-y-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-base font-semibold">{t('ai.title', 'Grounded explanation')}</h3>
        <ProvChip kind="signal" />
        {r?.available && (
          <span className={`chip ${r.badge === 'VALIDATED' ? 'chip-fact' : 'chip-corr'}`} data-testid="ai-badge">
            {r.badge === 'VALIDATED' ? t('ai.validated', 'Validated') : t('ai.fallback', 'Deterministic fallback')}
          </span>
        )}
        {r?.available && r.model && <span className="mono text-xs text-muted-foreground">{r.model}</span>}
        {canMake && (
          <Button size="sm" variant="outline" className="ml-auto" disabled={make.isPending} onClick={() => make.mutate(!!r?.available)}>
            {make.isPending ? t('common.loading', 'Loading') + '…' : r?.available ? t('ai.regenerate', 'Regenerate') : t('ai.generate', 'Generate grounded explanation')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('ai.note', 'Written only from this case’s validated evidence pack. Every sentence cites evidence ids and is checked before you see it. It explains; it never decides.')}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {r?.available && r.validation.fallbackReason && r.badge !== 'VALIDATED' && (
        <p className="text-xs text-muted-foreground">{t('ai.why', 'Shown instead of the model’s text')}: {r.validation.fallbackReason}.</p>
      )}
      {r?.available && r.content.sections && (
        <div className="space-y-5">
          {ORDER.filter((k) => r.content.sections?.[k]?.length).map((k) => (
            <div key={k} className="space-y-1.5">
              <p className="eyebrow">{SECTION_LABEL[k]}</p>
              <ul className="space-y-1.5">
                {r.content.sections![k].map((s, i) => (
                  <li key={i} className="text-[0.95rem] leading-relaxed">
                    {s.text}{' '}
                    <span className="mono whitespace-nowrap text-[0.65rem] text-muted-foreground">{s.citations.map((c) => <span key={c} className="mr-1 rounded border px-1 py-0.5">{c}</span>)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
