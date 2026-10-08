import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError, newIdempotencyKey } from '@/lib/api'
import type { ActionName, CaseDetail, Me, ReviewResponse } from '@/lib/types'
import { REASON_CODES } from '@/lib/types'

type Mode = 'ACCEPT' | 'MODIFY' | 'REJECT' | 'REQUEST_INFO'

const REVIEWABLE = ['NEW', 'TRIAGED', 'IN_REVIEW', 'NEED_INFO']
const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: 'ACCEPT', label: 'Accept', hint: 'Agree with the proposed action.' },
  { mode: 'MODIFY', label: 'Modify', hint: 'Choose a different permitted action or pattern. A reason is required.' },
  { mode: 'REJECT', label: 'Reject', hint: 'The proposal or the case is not warranted. A reason is required.' },
  { mode: 'REQUEST_INFO', label: 'Request info', hint: 'Pause the case and say what is needed.' },
]

export function DecisionPanel({ detail, me, onChanged }: { detail: CaseDetail; me: Me; onChanged: () => void }) {
  const [mode, setMode] = useState<Mode>('ACCEPT')
  const [newAction, setNewAction] = useState<ActionName>(detail.defaultAction)
  const [hypothesis, setHypothesis] = useState(detail.hypotheses[0].code)
  const [reasonCode, setReasonCode] = useState('')
  const [notes, setNotes] = useState('')
  const [key, setKey] = useState(newIdempotencyKey)
  const [error, setError] = useState<string | null>(null)
  // the confirmation, with the status the case had when the decision was sent
  const [done, setDone] = useState<{ result: ReviewResponse; from: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // visible while the case is still in the status it had when sent, or in the status the server reported;
  // hidden once the case has moved on to anything else (so a stale confirmation never lingers)
  const current = done && (detail.status === done.from || detail.status === done.result.caseStatus) ? done.result : null

  const allowedRole = me.role === 'INVESTIGATOR' || me.role === 'SUPERVISOR'
  if (!allowedRole) {
    return <p>Your role ({me.role}) is read-only for case decisions.</p>
  }
  if (!REVIEWABLE.includes(detail.status)) {
    // After a successful decision the case refreshes into a non-reviewable status; keep the confirmation visible.
    if (current) return <Confirmation result={current} />
    return <p>This case is {detail.status} and cannot be reviewed again.</p>
  }

  const changed = newAction !== detail.defaultAction || hypothesis !== detail.hypotheses[0].code
  let problem: string | null = null
  if ((mode === 'MODIFY' || mode === 'REJECT') && !reasonCode) problem = 'Choose a reason code.'
  else if (mode === 'MODIFY' && !changed) problem = 'Change the action or the pattern first.'
  else if (mode === 'REQUEST_INFO' && !notes.trim()) problem = 'Say what information is needed.'

  async function submit() {
    setBusy(true)
    setError(null)
    const body: Record<string, unknown> = { action: mode }
    if (mode === 'MODIFY') {
      body.newAction = newAction
      body.hypothesis = hypothesis
    }
    if (mode === 'MODIFY' || mode === 'REJECT') body.reasonCode = reasonCode
    if (notes.trim()) body.notes = notes.trim()
    try {
      const res = await api<ReviewResponse>(`/api/cases/${detail.caseId}/review`, {
        method: 'POST',
        body,
        idempotencyKey: key,
      })
      setDone({ result: res, from: detail.status })
      setKey(newIdempotencyKey())
      onChanged()
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'The decision could not be recorded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Proposed by the rules: <strong>{detail.defaultAction}</strong> (no model is involved in this build).
      </p>
      <div role="radiogroup" aria-label="Decision" className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <Button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={mode === m.mode}
            variant={mode === m.mode ? 'default' : 'outline'}
            onClick={() => setMode(m.mode)}
          >
            {m.label}
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{MODES.find((m) => m.mode === mode)?.hint}</p>

      {mode === 'MODIFY' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="newAction">Action</Label>
            <select
              id="newAction"
              className="h-9 w-full rounded-md border px-2"
              value={newAction}
              onChange={(e) => setNewAction(e.target.value as ActionName)}
            >
              {detail.permittedActions.map((a) => (
                <option key={a.action} value={a.action}>
                  {a.action}
                  {a.needs === 'SUPERVISOR' ? ' (needs supervisor approval)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="hypothesis">Pattern</Label>
            <select
              id="hypothesis"
              className="h-9 w-full rounded-md border px-2"
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
            >
              {detail.hypotheses.map((h) => (
                <option key={h.code} value={h.code}>
                  {h.code}: {h.text}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {(mode === 'MODIFY' || mode === 'REJECT') && (
        <div className="space-y-1">
          <Label htmlFor="reason">Reason code</Label>
          <select
            id="reason"
            className="h-9 w-full rounded-md border px-2"
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
          >
            <option value="">Select a reason…</option>
            {REASON_CODES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="notes">Notes{mode === 'REQUEST_INFO' ? ' (required)' : ' (optional)'}</Label>
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {problem && <p className="text-sm text-muted-foreground">{problem}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="button" onClick={submit} disabled={busy || problem !== null}>
        Record decision
      </Button>

      {current && <Confirmation result={current} />}
    </div>
  )
}

/** Reports the status the SERVER returned for this decision (authoritative), not whatever is on screen. */
function Confirmation({ result }: { result: ReviewResponse }) {
  return (
    <p role="status" className="text-sm">
      Recorded. Case is now <strong>{result.caseStatus}</strong>
      {result.requiresApproval ? ' and waits for a supervisor to approve.' : '.'}
    </p>
  )
}
