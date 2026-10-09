import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RateAI } from '@/features/review/RateAI'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { SentenceReview } from '@/features/review/ReviewViews'
import { api, ApiError } from '@/lib/api'
import type { Me } from '@/lib/types'
import type { AiSentence, CopilotAnswer, GroundedOutput } from '@/lib/types2'

export function AiBadge({ r }: { r: Pick<GroundedOutput, 'badge' | 'model'> }) {
  const { t } = useTranslation()
  const ok = r.badge === 'VALIDATED'
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`chip ${ok ? 'chip-fact' : 'chip-corr'}`} data-testid="ai-badge">
        {ok ? t('ai.validated', 'Validated') : t('ai.fallback', 'Deterministic fallback')}
      </span>
      {ok && r.model && <span className="mono text-[0.65rem] text-muted-foreground">{r.model}</span>}
    </span>
  )
}

export function Cites({ ids }: { ids: string[] }) {
  return (
    <span className="mono whitespace-nowrap text-[0.65rem] text-muted-foreground">
      {ids.map((c) => <span key={c} className="mr-1 rounded border px-1 py-0.5">{c}</span>)}
    </span>
  )
}

export function Sentences({ items, tone, review }: { items: AiSentence[]; tone?: 'plain' | 'against'; review?: { caseId: string; prefix: string } }) {
  return (
    <ul className="space-y-2">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3 text-[0.95rem] leading-relaxed">
          <span aria-hidden className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'against' ? 'bg-[var(--warn)]' : 'bg-[var(--signal)]'}`} />
          <span>{s.text} <Cites ids={s.citations} />{review && <SentenceReview caseId={review.caseId} subject={`${review.caseId}:${review.prefix}:${i}`} text={s.text} />}</span>
        </li>
      ))}
    </ul>
  )
}

const SUGGESTED = [
  'Why was this flagged?',
  'How confident are we, and why?',
  'What evidence is missing?',
  'How many members are affected?',
  'Could there be an innocent explanation?',
]

/** Ask one question about this case. Answers come only from the validated pack; "not in the pack" is a valid answer. */
export function CopilotPanel({ caseId, me }: { caseId: string; me: Me }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [log, setLog] = useState<CopilotAnswer[]>([])
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const ask = useMutation({
    mutationFn: (question: string) => api<CopilotAnswer>(`/api/cases/${caseId}/copilot`, { method: 'POST', body: { question } }),
    onSuccess: (r) => {
      setError(null)
      setLog((l) => [...l, r])
      setQ('')
      setTimeout(() => end.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }), 50)
    },
    onError: (e) => setError(e instanceof ApiError ? e.detail : t('common.error')),
  })
  if (me.role === 'AUDITOR') return <p className="text-sm text-muted-foreground">{t('copilot.auditor', 'Auditors can read explanations but not ask the copilot.')}</p>
  const submit = (text: string) => {
    const v = text.trim()
    if (v && !ask.isPending) ask.mutate(v)
  }
  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">{t('copilot.eyebrow', 'Investigation copilot')}</p>
        <h3 className="text-lg font-semibold">{t('copilot.title', 'Ask about this case')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('copilot.note', 'Answers use only this case’s validated evidence. Numbers come from the backend, every sentence cites its source, and if the pack does not contain the answer it says so.')}</p>
      </div>
      <div className="flex flex-wrap gap-2" aria-label={t('copilot.suggested', 'Suggested questions')}>
        {SUGGESTED.map((s) => (
          <button key={s} type="button" disabled={ask.isPending} onClick={() => submit(s)} className="rounded-full border px-3 py-1 text-xs transition hover:border-[var(--signal)] hover:bg-muted disabled:opacity-50">{s}</button>
        ))}
      </div>
      <div className="space-y-4" aria-live="polite">
        {log.map((a, i) => (
          <div key={i} className="space-y-2">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-muted px-4 py-2 text-sm">{a.question}</p>
            <div className="max-w-[95%] space-y-2 rounded-2xl rounded-bl-sm border bg-card px-4 py-3">
              {a.content.answerable === false ? (
                <p className="text-sm">{a.content.notInPack}</p>
              ) : (
                <Sentences items={a.content.sections?.answer ?? []} review={{ caseId, prefix: `copilot-${log.indexOf(a)}` }} />
              )}
              {a.content.answerable !== false && <RateAI kind="COPILOT" subject={`${caseId}:${i}`} caseId={caseId} text={a.question} />}
              {(a.content.sections?.followUps?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {a.content.sections!.followUps.map((f, k) => (
                    <button key={k} type="button" onClick={() => submit(f.text)} className="rounded-full border px-3 py-1 text-xs hover:bg-muted">{f.text}</button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 border-t pt-2"><AiBadge r={a} /></div>
            </div>
          </div>
        ))}
        {ask.isPending && <div className="h-10 w-2/3 animate-pulse rounded-2xl bg-muted" role="status" aria-label={t('common.loading', 'Loading')} />}
        <div ref={end} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(q) }}>
        <label className="sr-only" htmlFor="copilot-q">{t('copilot.ask', 'Ask a question')}</label>
        <input id="copilot-q" maxLength={300} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('copilot.placeholder', 'Ask about the evidence, impact, confidence or network')} className="h-10 flex-1 rounded-full border bg-transparent px-4 text-sm outline-none focus:border-[var(--signal)]" />
        <Button type="submit" disabled={!q.trim() || ask.isPending}>{t('copilot.send', 'Ask')}</Button>
      </form>
    </div>
  )
}

/** The strongest honest case against the flag, from conflicting and missing evidence only. It never changes the decision. */
export function ChallengePanel({ caseId, me }: { caseId: string; me: Me }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const q = useQuery<GroundedOutput>({ queryKey: ['challenge', caseId], queryFn: () => api(`/api/cases/${caseId}/challenge`) })
  const make = useMutation({
    mutationFn: (force: boolean) => api<GroundedOutput>(`/api/cases/${caseId}/challenge?force=${force}`, { method: 'POST' }),
    onSuccess: (r) => { setError(null); qc.setQueryData(['challenge', caseId], { ...r, available: true }) },
    onError: (e) => setError(e instanceof ApiError ? e.detail : t('common.error')),
  })
  const r = q.data
  const s = r?.available ? r.content.sections : undefined
  return (
    <div className="@container space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="eyebrow">{t('challenge.eyebrow', 'Devil’s advocate')}</p>
          <h3 className="text-lg font-semibold">{t('challenge.title', 'Challenge this case')}</h3>
        </div>
        {r?.available && <AiBadge r={r} />}
        {me.role !== 'AUDITOR' && (
          <Button className="ml-auto" size="sm" variant="outline" disabled={make.isPending} onClick={() => make.mutate(!!r?.available)}>
            {make.isPending ? t('common.loading', 'Loading') + '…' : r?.available ? t('ai.regenerate', 'Regenerate') : t('challenge.run', 'Argue the other side')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('challenge.note', 'A sceptic’s view built only from the conflicting and missing evidence in the pack. It does not change the decision or the confidence; it shows what would settle the doubt.')}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {s && (
        <div className="grid gap-px overflow-hidden rounded-[var(--radius)] border bg-border @xl:grid-cols-2">
          <div className="space-y-3 bg-card p-5">
            <p className="eyebrow">{t('challenge.against', 'The case against flagging')}</p>
            {s.headline?.length > 0 && <p className="display text-xl leading-snug">{s.headline[0].text}</p>}
            <Sentences items={s.counterArguments ?? []} tone="against" review={{ caseId, prefix: 'challenge' }} />
            {(s.innocentExplanations?.length ?? 0) > 0 && (
              <>
                <p className="eyebrow pt-2">{t('challenge.innocent', 'Legitimate explanations to rule out')}</p>
                <Sentences items={s.innocentExplanations} tone="against" />
              </>
            )}
          </div>
          <div className="space-y-3 bg-card p-5">
            <p className="eyebrow">{t('challenge.settle', 'What would settle it')}</p>
            <Sentences items={s.whatWouldChangeTheView ?? []} />
            <RateAI kind="CHALLENGE" subject={caseId} caseId={caseId} className="mt-3" />
          </div>
        </div>
      )}
    </div>
  )
}
