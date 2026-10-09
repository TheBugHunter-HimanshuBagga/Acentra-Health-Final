import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RateAI } from '@/features/review/RateAI'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProvChip } from '@/components/Provenance'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '@/lib/api'
import { AnimatedBar } from '@/lib/motion'
import type { Me } from '@/lib/types'
import type { KnowledgeItem, Memory, ReasoningOutput } from '@/lib/types2'

const STRENGTH_CHIP: Record<string, string> = { STRONG: 'chip-fact', PARTIAL: 'chip-signal', CONFLICTING: 'chip-corr' }

/** What the organisation already knows about cases like this one, why it is shown, and how much it influenced the recommendation. */
export function InstitutionalMemory({ caseId, me }: { caseId: string; me: Me }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const mem = useQuery<Memory>({ queryKey: ['memory', caseId], queryFn: () => api(`/api/cases/${caseId}/institutional-memory`) })
  const pr = useQuery<ReasoningOutput>({ queryKey: ['prec-reasoning', caseId], queryFn: () => api(`/api/cases/${caseId}/precedent-reasoning`) })
  const [err, setErr] = useState<string | null>(null)
  const explain = useMutation({
    mutationFn: () => api<ReasoningOutput>(`/api/cases/${caseId}/precedent-reasoning?force=true`, { method: 'POST' }),
    onSuccess: (r) => qc.setQueryData(['prec-reasoning', caseId], { ...r, available: true }),
    onError: (e) => setErr(e instanceof ApiError ? e.detail : t('common.error')),
  })
  if (mem.isError) return <p className="text-sm text-muted-foreground">{t('memory.na', 'Institutional memory is not available for this case.')}</p>
  if (!mem.data) return <div className="h-24 animate-pulse rounded-lg bg-muted" />
  const m = mem.data
  const narr = pr.data?.available ? pr.data.content.precedents : undefined
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[0.95rem] font-medium">{m.summary}</p>
        <span className={`chip ${m.knowledgeConfidence === 'STRONG' ? 'chip-fact' : m.knowledgeConfidence === 'PARTIAL' ? 'chip-signal' : ''}`}>
          {t('memory.knowledge', 'Knowledge confidence')}: {m.knowledgeConfidence.toLowerCase()}
        </span>
        {me.role !== 'AUDITOR' && m.precedents.length > 0 && (
          <Button size="sm" variant="outline" className="ml-auto" disabled={explain.isPending} onClick={() => explain.mutate()}>
            {explain.isPending ? t('common.loading', 'Loading') + '…' : t('memory.explain', 'Explain the precedents')}
          </Button>
        )}
      </div>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      {pr.data?.available && pr.data.content.overallNarrative && (
        <p className="text-sm">{pr.data.content.overallNarrative} <span className="chip chip-fact ml-1">{t('ai.validated', 'Validated')}</span></p>
      )}
      {pr.data?.available && pr.data.content.overallNarrative && <RateAI kind="PRECEDENT" subject={caseId} caseId={caseId} />}
      <ul className="space-y-3">
        {m.precedents.map((p, i) => {
          const n = narr?.find((x) => x.precedentId === p.precedentId)
          return (
            <li key={p.precedentId} className="panel space-y-2 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono text-xs">PR{i + 1} · {p.precedentId}</span>
                <span className={`chip ${STRENGTH_CHIP[p.strength]}`}>{p.strength.toLowerCase()}</span>
                <span className="chip chip-human">{t('memory.closed', 'closed')} {p.disposition.toLowerCase()}</span>
                <span className="eyebrow">{p.source === 'LIVE' ? `${t('memory.reviewer', 'added by a reviewer')}${p.cosignedBy ? ` · co-signed by ${p.cosignedBy}` : ''}` : t('memory.seed', 'seed')}</span>
                <span className="ml-auto flex items-center gap-2"><span className="h-1 w-14 rounded bg-muted"><AnimatedBar value={p.similarity} className="bg-[var(--signal)]" /></span><span className="num text-xs">{p.similarity.toFixed(2)}</span></span>
              </div>
              <p className="text-xs text-muted-foreground"><span className="eyebrow mr-1">{t('memory.why', 'Why am I seeing this precedent?')}</span>{p.whyShown}</p>
              {p.rationale && <p>{p.rationale}</p>}
              {n?.relevanceNarrative && <p className="border-l-2 border-[var(--signal)] pl-3">{n.relevanceNarrative}</p>}
              {n?.differencesNarrative && <p className="border-l-2 pl-3 text-muted-foreground">{n.differencesNarrative}</p>}
            </li>
          )
        })}
      </ul>
      {m.approvedKnowledge.length > 0 && (
        <div className="space-y-2">
          <p className="eyebrow">{t('memory.approved', 'Approved knowledge about this pattern')}</p>
          <ul className="space-y-2">
            {m.approvedKnowledge.map((k) => (
              <li key={k.itemId} className="panel p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="mono text-xs">{k.itemId}</span><span className="chip chip-human">{k.kind.replace('_', ' ').toLowerCase()}</span><span className="eyebrow">{t('memory.from', 'from')} {k.caseId}</span></div>
                <p className="mt-1">{k.text}</p>
                {k.whyShown && <p className="mt-1 text-xs text-muted-foreground">{k.whyShown}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const CATEGORIES: [string, string][] = [
  ['INCORRECT_REASONING', 'Incorrect reasoning'],
  ['MISSING_EVIDENCE', 'Missing evidence'],
  ['WRONG_CONFIDENCE', 'Wrong confidence'],
  ['IRRELEVANT_PRECEDENT', 'Irrelevant precedent'],
  ['INCORRECT_RECOMMENDATION', 'Incorrect recommendation'],
  ['INSUFFICIENT_EXPLANATION', 'Insufficient explanation'],
  ['OTHER', 'Other'],
]

/** Structured investigator feedback. It is stored and reviewed; it never retrains anything or edits a rule by itself. */
export function FeedbackPanel({ caseId, me }: { caseId: string; me: Me }) {
  const { t } = useTranslation()
  const [rating, setRating] = useState<'USEFUL' | 'NOT_USEFUL' | null>(null)
  const [cats, setCats] = useState<string[]>([])
  const [target, setTarget] = useState('REASONING')
  const [decision, setDecision] = useState('NONE')
  const [comment, setComment] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: () => api<{ effect: string }>(`/api/cases/${caseId}/feedback`, { method: 'POST', body: { target, rating, categories: cats, comment: comment || undefined, decision } }),
    onSuccess: (r) => {
      setDone(r.effect)
      setError(null)
    },
    onError: (e) => setError(e instanceof ApiError ? e.detail : t('common.error')),
  })
  if (me.role === 'AUDITOR') return null
  if (done) return <p role="status" className="text-sm">{t('feedback.thanks', 'Thank you.')} {done}</p>
  return (
    <section aria-labelledby="fb-h" className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="fb-h" className="text-sm font-semibold">{t('feedback.title', 'Was the AI help useful?')}</h3>
        <ProvChip kind="human" />
      </div>
      <div className="flex gap-2" role="group" aria-label={t('feedback.title', 'Was the AI help useful?')}>
        <Button size="sm" variant={rating === 'USEFUL' ? 'secondary' : 'outline'} aria-pressed={rating === 'USEFUL'} onClick={() => setRating('USEFUL')}>{t('feedback.useful', 'Useful')}</Button>
        <Button size="sm" variant={rating === 'NOT_USEFUL' ? 'secondary' : 'outline'} aria-pressed={rating === 'NOT_USEFUL'} onClick={() => setRating('NOT_USEFUL')}>{t('feedback.notUseful', 'Not useful / Needs improvement')}</Button>
      </div>
      {rating && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="space-y-1"><span className="eyebrow block">{t('feedback.about', 'About')}</span>
              <select className="h-8 rounded-full border bg-transparent px-2 text-xs" value={target} onChange={(e) => setTarget(e.target.value)}>
                {['REASONING', 'BRIEF', 'PRECEDENT', 'RECOMMENDATION'].map((x) => <option key={x} value={x}>{x.toLowerCase()}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span className="eyebrow block">{t('feedback.decision', 'You…')}</span>
              <select className="h-8 rounded-full border bg-transparent px-2 text-xs" value={decision} onChange={(e) => setDecision(e.target.value)}>
                <option value="NONE">{t('feedback.none', 'have no decision yet')}</option><option value="ACCEPTED">{t('feedback.accepted', 'accepted the recommendation')}</option>
                <option value="MODIFIED">{t('feedback.modified', 'modified it')}</option><option value="REJECTED">{t('feedback.rejected', 'rejected it')}</option>
              </select>
            </label>
          </div>
          {rating === 'NOT_USEFUL' && (
            <fieldset className="flex flex-wrap gap-2" aria-label={t('feedback.what', 'What was wrong?')}>
              {CATEGORIES.map(([k, label]) => (
                <label key={k} className={`chip cursor-pointer ${cats.includes(k) ? 'chip-corr' : ''}`}>
                  <input type="checkbox" className="sr-only" checked={cats.includes(k)} onChange={() => setCats((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))} />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          <label className="block space-y-1"><span className="eyebrow">{t('feedback.comment', 'Comment (required if you modified or rejected)')}</span>
            <Textarea rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button size="sm" disabled={send.isPending} onClick={() => send.mutate()}>{t('feedback.send', 'Send feedback')}</Button>
          <p className="text-xs text-muted-foreground">{t('feedback.note', 'Stored for supervisor review. It does not change any rule, score or model by itself.')}</p>
        </div>
      )}
    </section>
  )
}

/** After a case is closed: draft lessons, then a second person approves or rejects each one. */
export function KnowledgePanel({ caseId, status, me }: { caseId: string; status: string; me: Me }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const items = useQuery<KnowledgeItem[]>({ queryKey: ['knowledge-items', caseId], queryFn: () => api(`/api/knowledge-items?caseId=${caseId}`), enabled: status === 'CLOSED' })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['knowledge-items'] })
    void qc.invalidateQueries({ queryKey: ['memory'] })
    void qc.invalidateQueries({ queryKey: ['growth'] })
  }
  const extract = useMutation({
    mutationFn: () => api<KnowledgeItem[]>(`/api/cases/${caseId}/knowledge/extract`, { method: 'POST' }),
    onSuccess: () => { setError(null); refresh() },
    onError: (e) => setError(e instanceof ApiError ? e.detail : t('common.error')),
  })
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) => api(`/api/knowledge-items/${id}/decision`, { method: 'POST', body: { decision, notes } }),
    onSuccess: () => { setError(null); setNotes(''); refresh() },
    onError: (e) => setError(e instanceof ApiError ? e.detail : t('common.error')),
  })
  if (status !== 'CLOSED') return null
  const list = items.data ?? []
  const reviewer = me.role === 'SUPERVISOR' || me.role === 'GOVERNANCE'
  return (
    <section aria-labelledby="kp-h" className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="kp-h" className="text-sm font-semibold">{t('knowledge.title', 'Lessons from this closed case')}</h3>
        {list.length === 0 && (me.role === 'INVESTIGATOR' || me.role === 'SUPERVISOR') && (
          <Button size="sm" variant="outline" disabled={extract.isPending} onClick={() => extract.mutate()}>{t('knowledge.extract', 'Draft lessons for review')}</Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <ul className="space-y-2">
        {list.map((k) => (
          <li key={k.itemId} className="panel space-y-1 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mono text-xs">{k.itemId}</span>
              <span className="chip chip-human">{k.kind.replace('_', ' ').toLowerCase()}</span>
              <span className={`chip ${k.status === 'APPROVED' ? 'chip-fact' : k.status === 'REJECTED' ? '' : 'chip-corr'}`}>{k.status.replace('_', ' ').toLowerCase()}</span>
              <span className="eyebrow">{k.source === 'AI' ? `AI draft · ${k.model ?? ''}` : t('knowledge.deterministic', 'from recorded decisions')}</span>
            </div>
            <p>{k.text}</p>
            {k.status === 'PENDING_REVIEW' && reviewer && k.createdBy !== me.username && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input aria-label={t('knowledge.notes', 'Review notes')} placeholder={t('knowledge.notes', 'Review notes')} className="h-8 min-w-[10rem] flex-1 rounded-full border bg-transparent px-3 text-xs" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: k.itemId, decision: 'APPROVE' })}>{t('knowledge.approve', 'Approve')}</Button>
                <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: k.itemId, decision: 'REJECT' })}>{t('knowledge.reject', 'Reject')}</Button>
              </div>
            )}
            {k.status === 'PENDING_REVIEW' && k.createdBy === me.username && <p className="text-xs text-muted-foreground">{t('knowledge.secondPerson', 'A second person must review this draft.')}</p>}
            {k.reviewedBy && <p className="text-xs text-muted-foreground">{k.status.toLowerCase()} by {k.reviewedBy}{k.reviewNotes ? `: ${k.reviewNotes}` : ''}</p>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t('knowledge.note', 'Approved lessons are shown next to similar future cases. They inform explanations; only the precedent and exception governance can change a score or a rule.')}</p>
    </section>
  )
}

interface FeedbackSummary {
  total: number
  useful: number
  notUseful: number
  byCategory: Record<string, number>
}

/** The review board: lessons waiting for a second person, approved knowledge, and what investigators say is not working. */
export function KnowledgeBoard({ me }: { me: Me }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const pending = useQuery<KnowledgeItem[]>({ queryKey: ['knowledge-items', 'PENDING_REVIEW'], queryFn: () => api('/api/knowledge-items?status=PENDING_REVIEW') })
  const approved = useQuery<KnowledgeItem[]>({ queryKey: ['knowledge-items', 'APPROVED'], queryFn: () => api('/api/knowledge-items?status=APPROVED') })
  const fb = useQuery<FeedbackSummary>({ queryKey: ['feedback-summary'], queryFn: () => api('/api/feedback/summary'), enabled: me.role !== 'INVESTIGATOR', retry: false })
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) => api(`/api/knowledge-items/${id}/decision`, { method: 'POST', body: { decision, notes: notes[id] ?? '' } }),
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['knowledge-items'] }); void qc.invalidateQueries({ queryKey: ['growth'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.detail : t('common.error')),
  })
  const reviewer = me.role === 'SUPERVISOR' || me.role === 'GOVERNANCE'
  const list = pending.data ?? []
  return (
    <section className="space-y-5" aria-labelledby="kb-h">
      <div>
        <p className="eyebrow">{t('kb.eyebrow', 'Governed learning')}</p>
        <h2 id="kb-h" className="text-xl font-semibold">{t('kb.title', 'Lessons waiting for review')} ({list.length})</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('kb.note', 'Case, feedback, pattern extraction, review, approved knowledge. One person’s feedback never changes a rule or a score.')}</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {list.length === 0 && <p className="text-sm text-muted-foreground">{t('kb.none', 'No lesson is waiting.')}</p>}
      <ul className="space-y-2">
        {list.map((k) => (
          <li key={k.itemId} className="panel space-y-1 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><span className="mono text-xs">{k.itemId}</span><span className="chip chip-human">{k.kind.replace('_', ' ').toLowerCase()}</span><span className="eyebrow">{k.caseId} · {k.source === 'AI' ? 'AI draft' : 'from recorded decisions'} · by {k.createdBy}</span></div>
            <p>{k.text}</p>
            {reviewer && k.createdBy !== me.username ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input aria-label={`Review notes for ${k.itemId}`} placeholder={t('knowledge.notes', 'Review notes')} className="h-8 min-w-[10rem] flex-1 rounded-full border bg-transparent px-3 text-xs" value={notes[k.itemId] ?? ''} onChange={(e) => setNotes({ ...notes, [k.itemId]: e.target.value })} />
                <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: k.itemId, decision: 'APPROVE' })}>{t('knowledge.approve', 'Approve')}</Button>
                <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: k.itemId, decision: 'REJECT' })}>{t('knowledge.reject', 'Reject')}</Button>
              </div>
            ) : <p className="text-xs text-muted-foreground">{reviewer ? t('knowledge.secondPerson', 'A second person must review this draft.') : t('kb.reviewers', 'Supervisors and governance review these.')}</p>}
          </li>
        ))}
      </ul>
      {(approved.data?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <p className="eyebrow">{t('kb.approved', 'Approved knowledge')} ({approved.data!.length})</p>
          <ul className="divide-y border-y text-sm">{approved.data!.map((k) => <li key={k.itemId} className="py-2"><span className="mono mr-2 text-xs">{k.itemId}</span>{k.text}<span className="block text-xs text-muted-foreground">{k.caseId} · approved by {k.reviewedBy}</span></li>)}</ul>
        </div>
      )}
      {fb.data && (
        <div className="space-y-2">
          <p className="eyebrow">{t('kb.feedback', 'Investigator feedback')}</p>
          <p className="text-sm">{fb.data.total} items: {fb.data.useful} useful, {fb.data.notUseful} not useful{Object.keys(fb.data.byCategory).length > 0 ? ` (${Object.entries(fb.data.byCategory).map(([k, v]) => `${k.replace(/_/g, ' ').toLowerCase()} ${v}`).join(', ')})` : ''}.</p>
        </div>
      )}
    </section>
  )
}
