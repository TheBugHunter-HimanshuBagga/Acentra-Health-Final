// Where people push back. Everything here is a proposal or a note: it is recorded, audited and shown to reviewers, and
// nothing changes a score, a rule or a policy by itself.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, MessageSquareWarning, ThumbsDown, ThumbsUp, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { AiBadge } from '@/components/insight/CopilotViews'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import { useMe } from '@/lib/auth'

interface Note { id: string; subjectType: string; subjectId: string; caseId: string | null; by: string; role: string; verdict: string; note: string; proposal: string | null; at: string }
interface Finding { key: string; severity: string; area: string; issue: string; suggestion: string; refs: string[] }
interface Critique { badge: 'VALIDATED' | 'TEMPLATE_FALLBACK'; model: string | null; fallbackReason: string | null; findings: Finding[] }
interface Proposal { targetType: string; targetId: string; original: string; proposed: string | null; rationale: string; badge: 'VALIDATED' | 'TEMPLATE_FALLBACK'; model: string | null }
export interface Item { type: 'POLICY' | 'RULE' | 'GLOSSARY' | 'HELP'; id: string; label: string }

const SEV: Record<string, string> = { HIGH: 'var(--tier-high)', MEDIUM: 'var(--tier-medium)', LOW: 'var(--tier-monitor)' }

/** Agree or disagree with one AI sentence, with a reason. Shown under every AI sentence on the case. */
export function SentenceReview({ caseId, subject, text }: { caseId: string; subject: string; text: string }) {
  const me = useMe().data
  const qc = useQueryClient()
  const [mode, setMode] = useState<'idle' | 'disagree' | 'done'>('idle')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: (b: { verdict: string; note: string }) => api('/api/review/notes', { method: 'POST', body: { subjectType: 'AI_SENTENCE', subjectId: subject, caseId, ...b, proposal: text } }),
    onSuccess: () => { setMode('done'); void qc.invalidateQueries({ queryKey: ['review-notes'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.detail : 'Could not record that.'),
  })
  if (!me || me.role === 'AUDITOR') return null
  if (mode === 'done') return <span className="mono ml-2 text-[0.62rem] text-muted-foreground"><Check aria-hidden className="mr-0.5 inline h-3 w-3" />recorded for review</span>
  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-1 align-middle">
      <button type="button" aria-label="Agree with this sentence" title="Agree" onClick={() => send.mutate({ verdict: 'AGREE', note: '' })} className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"><ThumbsUp aria-hidden className="h-3 w-3" /></button>
      <button type="button" aria-label="Disagree with this sentence" title="Disagree" onClick={() => setMode('disagree')} className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-[var(--tier-high)]"><ThumbsDown aria-hidden className="h-3 w-3" /></button>
      {mode === 'disagree' && (
        <span className="notif-pop mt-1 flex w-full min-w-[16rem] items-center gap-1.5">
          <input autoFocus aria-label="Why do you disagree?" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Why do you disagree?" className="h-7 flex-1 rounded-full border bg-transparent px-3 text-xs outline-none focus:border-[var(--signal)]" />
          <Button size="xs" disabled={!note.trim() || send.isPending} onClick={() => send.mutate({ verdict: 'DISAGREE', note })}>Record</Button>
          <button type="button" className="text-xs text-muted-foreground" onClick={() => setMode('idle')}>Cancel</button>
        </span>
      )}
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </span>
  )
}

function FindingCard({ f }: { f: Finding }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'idle' | 'disagree' | 'done'>('idle')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: (b: { verdict: string; note: string }) => api('/api/review/notes', { method: 'POST', body: { subjectType: 'CRITIQUE_FINDING', subjectId: f.key, proposal: `${f.issue} ${f.suggestion}`, ...b } }),
    onSuccess: (_r, v) => { setMode('done'); void qc.invalidateQueries({ queryKey: ['review-notes'] }); void v },
    onError: (e) => setError(e instanceof ApiError ? e.detail : 'Could not record that.'),
  })
  return (
    <li className="space-y-2 rounded-xl border p-3.5">
      <p className="flex flex-wrap items-center gap-2 text-xs"><span className="mono rounded-full border px-1.5 py-0.5" style={{ color: SEV[f.severity] }}>{f.severity}</span><span className="eyebrow">{f.area}</span>{f.refs.map((r) => <span key={r} className="mono rounded border px-1 text-[0.62rem] text-muted-foreground">{r}</span>)}</p>
      <p className="text-sm">{f.issue}</p>
      <p className="text-sm text-muted-foreground">Suggestion: {f.suggestion}</p>
      {mode === 'done' ? <p className="text-xs text-muted-foreground">Your view was recorded in the review log.</p> : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" variant="outline" onClick={() => send.mutate({ verdict: 'AGREE', note: '' })}><ThumbsUp aria-hidden className="h-3 w-3" /> I agree</Button>
          <Button size="xs" variant="outline" onClick={() => setMode('disagree')}><ThumbsDown aria-hidden className="h-3 w-3" /> I disagree</Button>
          {mode === 'disagree' && (
            <span className="flex min-w-[16rem] flex-1 items-center gap-1.5">
              <input aria-label="Why do you disagree with this finding?" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Why?" className="h-7 flex-1 rounded-full border bg-transparent px-3 text-xs outline-none focus:border-[var(--signal)]" />
              <Button size="xs" disabled={!note.trim()} onClick={() => send.mutate({ verdict: 'DISAGREE', note })}>Record</Button>
            </span>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </li>
  )
}

function Critic() {
  const [error, setError] = useState<string | null>(null)
  const run = useMutation({ mutationFn: () => api<Critique>('/api/knowledge/critique', { method: 'POST' }), onError: (e) => setError(e instanceof ApiError ? e.detail : 'The critique could not run.') })
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="eyebrow">The sceptic's view</p>
          <h3 className="text-base font-semibold">Challenge this knowledge</h3>
        </div>
        {run.data && <AiBadge r={{ badge: run.data.badge, model: run.data.model }} />}
        <Button className="ml-auto" size="sm" disabled={run.isPending} onClick={() => { setError(null); run.mutate() }}><MessageSquareWarning aria-hidden className="h-3.5 w-3.5" /> {run.isPending ? 'Looking for weaknesses…' : run.data ? 'Run again' : 'Find weaknesses'}</Button>
      </div>
      <p className="text-xs text-muted-foreground">Looks for gaps, unclear items and patterns in reviewer feedback, using only the lint findings, rule and policy ids and aggregate feedback. It can cite only ids it was given. You decide whether it is right.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {run.data?.fallbackReason && run.data.badge !== 'VALIDATED' && <p className="text-xs text-muted-foreground">Built from the stored findings instead of the model: {run.data.fallbackReason}.</p>}
      {run.data && run.data.findings.length === 0 && <p className="text-sm">No weaknesses were found in the stored findings.</p>}
      <ul className="space-y-2.5">{run.data?.findings.map((f) => <FindingCard key={f.key} f={f} />)}</ul>
    </div>
  )
}

function FineTune({ items }: { items: Item[] }) {
  const qc = useQueryClient()
  const [type, setType] = useState<Item['type']>('POLICY')
  const [id, setId] = useState('')
  const [ins, setIns] = useState('')
  const [reject, setReject] = useState(false)
  const [note, setNote] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const list = items.filter((i) => i.type === type)
  const propose = useMutation({
    mutationFn: () => api<Proposal>('/api/knowledge/finetune', { method: 'POST', body: { targetType: type, targetId: id || list[0]?.id, instruction: ins } }),
    onSuccess: () => { setDone(null); setReject(false); setNote('') },
    onError: (e) => setError(e instanceof ApiError ? e.detail : 'Could not propose a rewording.'),
  })
  const decide = useMutation({
    mutationFn: (verdict: 'ACCEPT_PROPOSAL' | 'REJECT_PROPOSAL') => api('/api/review/notes', { method: 'POST', body: { subjectType: 'KNOWLEDGE_ITEM', subjectId: `${propose.data!.targetType}:${propose.data!.targetId}`, verdict, note, proposal: propose.data!.proposed } }),
    onSuccess: (_r, v) => { setDone(v === 'ACCEPT_PROPOSAL' ? 'Accepted: recorded for governance review. Nothing was changed.' : 'Rejected: your reason was recorded.'); void qc.invalidateQueries({ queryKey: ['review-notes'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.detail : 'Could not record that.'),
  })
  const p = propose.data
  return (
    <div className="space-y-3">
      <div><p className="eyebrow">Fine-tuning</p><h3 className="text-base font-semibold">Tell the system what is wrong, get a proposed rewording</h3></div>
      <p className="text-xs text-muted-foreground">Pick an item, say what should change, and the model proposes new wording from only that item and your correction. You accept or reject it; accepting records your decision for governance and applies nothing automatically.</p>
      <form className="grid gap-2 md:grid-cols-[9rem_1fr]" onSubmit={(e) => { e.preventDefault(); setError(null); propose.mutate() }}>
        <label className="sr-only" htmlFor="ft-type">Kind of item</label>
        <select id="ft-type" value={type} onChange={(e) => { setType(e.target.value as Item['type']); setId('') }} className="h-9 rounded-full border bg-transparent px-3 text-sm">
          <option value="POLICY">Policy</option><option value="RULE">Rule</option><option value="GLOSSARY">Glossary term</option><option value="HELP">Help article</option>
        </select>
        <label className="sr-only" htmlFor="ft-id">Item</label>
        <select id="ft-id" value={id || list[0]?.id || ''} onChange={(e) => setId(e.target.value)} className="h-9 rounded-full border bg-transparent px-3 text-sm">
          {list.map((i) => <option key={i.id} value={i.id}>{i.id} · {i.label.slice(0, 60)}</option>)}
        </select>
        <label className="sr-only" htmlFor="ft-ins">What should change</label>
        <textarea id="ft-ins" value={ins} onChange={(e) => setIns(e.target.value)} maxLength={600} rows={2} placeholder="What is wrong or unclear, and what should it say instead?" className="rounded-xl border bg-transparent p-2.5 text-sm outline-none focus:border-[var(--signal)] md:col-span-2" />
        <div className="md:col-span-2"><Button type="submit" size="sm" disabled={propose.isPending || ins.trim().length < 5 || list.length === 0}><Wand2 aria-hidden className="h-3.5 w-3.5" /> {propose.isPending ? 'Proposing…' : 'Propose wording'}</Button></div>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {p && (
        <div className="notif-pop space-y-3 rounded-xl border p-3.5">
          <div className="flex items-center gap-2"><AiBadge r={{ badge: p.badge, model: p.model }} /><span className="mono text-xs text-muted-foreground">{p.targetType} {p.targetId}</span></div>
          <div className="grid gap-3 md:grid-cols-2">
            <div><p className="eyebrow">Current</p><p className="mt-1 rounded-lg bg-muted/50 p-2.5 text-sm">{p.original}</p></div>
            <div><p className="eyebrow">Proposed</p><p className="mt-1 rounded-lg border border-[var(--signal)] p-2.5 text-sm">{p.proposed ?? 'No rewording was proposed.'}</p></div>
          </div>
          <p className="text-xs text-muted-foreground">{p.rationale}</p>
          {p.proposed && !done && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="xs" disabled={decide.isPending} onClick={() => decide.mutate('ACCEPT_PROPOSAL')}><Check aria-hidden className="h-3 w-3" /> Accept for review</Button>
              <Button size="xs" variant="outline" onClick={() => setReject(true)}>Reject</Button>
              {reject && (
                <span className="flex min-w-[16rem] flex-1 items-center gap-1.5">
                  <input aria-label="Why reject the rewording?" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Why?" className="h-7 flex-1 rounded-full border bg-transparent px-3 text-xs outline-none focus:border-[var(--signal)]" />
                  <Button size="xs" disabled={!note.trim()} onClick={() => decide.mutate('REJECT_PROPOSAL')}>Record</Button>
                </span>
              )}
            </div>
          )}
          {done && <p role="status" className="text-sm">{done}</p>}
        </div>
      )}
    </div>
  )
}

function ReviewLog() {
  const q = useQuery<Note[]>({ queryKey: ['review-notes'], queryFn: () => api('/api/review/notes?limit=20'), refetchInterval: 15_000 })
  return (
    <div className="space-y-2">
      <div><p className="eyebrow">Accountability</p><h3 className="text-base font-semibold">Human review log</h3></div>
      {(q.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No human reviews yet. Disagree with an AI sentence on a case, or challenge the knowledge above, and it appears here.</p>}
      <ul className="divide-y rounded-xl border">
        {(q.data ?? []).map((n) => (
          <li key={n.id} className="space-y-0.5 p-3 text-sm">
            <p className="flex flex-wrap items-center gap-2 text-xs"><span className="mono rounded-full border px-1.5 py-0.5" style={{ color: n.verdict.includes('DISAGREE') || n.verdict === 'REJECT_PROPOSAL' || n.verdict === 'BAD' ? 'var(--tier-high)' : n.verdict === 'FINE' ? 'var(--tier-medium)' : 'var(--ok)' }}>{n.verdict.replace('_', ' ').toLowerCase()}</span><span className="mono text-muted-foreground">{n.subjectType.toLowerCase().replace('_', ' ')} · {n.subjectId}</span><span className="text-muted-foreground">by {n.by} ({n.role.toLowerCase()})</span></p>
            {n.note && <p>{n.note}</p>}
            {n.proposal && <p className="truncate text-xs text-muted-foreground">{n.proposal}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Knowledge health, with the negative approach: stored findings, an AI critique, fine-tuning, and the human review log. */
export function KnowledgeHealth({ lint, items }: { lint: { severity: string; message: string }[]; items: Item[] }) {
  const me = useMe().data
  const canVoice = !!me && me.role !== 'AUDITOR'
  return (
    <section className="surface space-y-6 p-5" aria-labelledby="lint-h">
      <div>
        <h2 id="lint-h" className="font-medium">Knowledge health</h2>
        {lint.length === 0 ? (
          <p className="mt-1 text-sm">No conflicting precedents, stale exceptions or policy drift were found in the latest run.</p>
        ) : (
          <ul className="mt-1 list-disc pl-5 text-sm">{lint.map((x, i) => <li key={i}><strong>{x.severity}</strong> {x.message}</li>)}</ul>
        )}
      </div>
      {canVoice ? (
        <>
          <div className="border-t pt-5"><Critic /></div>
          <div className="border-t pt-5"><FineTune items={items} /></div>
        </>
      ) : <p className="border-t pt-4 text-sm text-muted-foreground">Auditors can read the review log below but not add to it.</p>}
      <div className="border-t pt-5"><ReviewLog /></div>
    </section>
  )
}
