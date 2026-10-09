// A visible "was this AI output any good?" strip. Good is one click; Fine and Bad ask for a reason (chips or free text).
// The rating is recorded and audited for reviewers and never changes a score, a rule or a case by itself.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ThumbsDown, ThumbsUp, Minus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import { useMe } from '@/lib/auth'

type Rating = 'GOOD' | 'FINE' | 'BAD'
const REASONS = ['Missing evidence', 'Wrong number', 'Too vague', 'Unclear wording', 'Not relevant', 'Too confident']

/** `kind` names the output (REASONING, BRIEF, COPILOT, CHALLENGE, NETWORK, CHAT, PRECEDENT); `subject` identifies the instance. */
export function RateAI({ kind, subject, caseId, text, className = '' }: { kind: string; subject: string; caseId?: string | null; text?: string; className?: string }) {
  const me = useMe().data
  const qc = useQueryClient()
  const [pick, setPick] = useState<Rating | null>(null)
  const [reasons, setReasons] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [done, setDone] = useState<Rating | null>(null)
  const [error, setError] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: (b: { verdict: Rating; note: string }) => api('/api/review/notes', { method: 'POST', body: { subjectType: 'AI_OUTPUT', subjectId: `${kind}:${subject}`, caseId: caseId ?? undefined, proposal: text?.slice(0, 1500), ...b } }),
    onSuccess: (_r, v) => { setDone(v.verdict); void qc.invalidateQueries({ queryKey: ['review-notes'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.detail : 'Could not record that.'),
  })
  if (!me || me.role === 'AUDITOR') return null
  if (done) return <p data-testid="rate-done" className={`mono text-[0.68rem] text-muted-foreground ${className}`}><Check aria-hidden className="mr-1 inline h-3 w-3" />Rated {done.toLowerCase()} · recorded for review, nothing changed automatically</p>
  const full = [...reasons, note.trim()].filter(Boolean).join('; ')
  return (
    <div role="group" aria-label="Rate this AI output" className={`rounded-xl border bg-[var(--surface-2,transparent)] px-3 py-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow">Rate this AI output</span>
        <Button size="xs" variant={pick === 'GOOD' ? 'default' : 'outline'} aria-pressed={pick === 'GOOD'} onClick={() => { setError(null); send.mutate({ verdict: 'GOOD', note: '' }) }}><ThumbsUp aria-hidden className="h-3 w-3" /> Good</Button>
        <Button size="xs" variant={pick === 'FINE' ? 'default' : 'outline'} aria-pressed={pick === 'FINE'} onClick={() => setPick('FINE')}><Minus aria-hidden className="h-3 w-3" /> Fine</Button>
        <Button size="xs" variant={pick === 'BAD' ? 'default' : 'outline'} aria-pressed={pick === 'BAD'} onClick={() => setPick('BAD')}><ThumbsDown aria-hidden className="h-3 w-3" /> Bad</Button>
      </div>
      {pick && (
        <div className="notif-pop mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">{pick === 'BAD' ? 'What was wrong?' : 'What could be better?'} Pick one or more, or write it.</p>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button key={r} type="button" aria-pressed={reasons.includes(r)} onClick={() => setReasons((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]))}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${reasons.includes(r) ? 'border-[var(--signal)] bg-[var(--signal)]/10' : 'text-muted-foreground hover:text-foreground'}`}>{r}</button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input aria-label="Your reason" value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder="Add detail (optional)" className="h-7 flex-1 rounded-full border bg-transparent px-3 text-xs outline-none focus:border-[var(--signal)]" />
            <Button size="xs" disabled={!full || send.isPending} onClick={() => { setError(null); send.mutate({ verdict: pick, note: full }) }}>Record rating</Button>
            <button type="button" className="text-xs text-muted-foreground" onClick={() => { setPick(null); setReasons([]); setNote('') }}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
