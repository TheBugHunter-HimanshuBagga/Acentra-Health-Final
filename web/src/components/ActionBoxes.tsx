import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError, newIdempotencyKey } from '@/lib/api'
import type { CaseDetail, Me, ReviewRecord } from '@/lib/types'
import { OUTCOMES, REASON_CODES } from '@/lib/types'

/** Supervisor approval of pending high-impact actions, and carrying out approved ones (simulated). */
export function ApprovalBox({ reviews, detail, me, onChanged }: {
  reviews: ReviewRecord[]; detail: CaseDetail; me: Me; onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const pending = reviews.filter((r) => r.status === 'PENDING_APPROVAL')
  const approved = reviews.filter((r) => r.status === 'APPROVED')

  async function decide(actionId: string, decision: 'APPROVE' | 'REJECT') {
    setError(null)
    try {
      await api(`/api/review-actions/${actionId}/approve`, { method: 'POST', body: { decision } })
      onChanged()
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'The approval could not be recorded.')
    }
  }

  async function execute(actionId: string) {
    setError(null)
    try {
      await api(`/api/review-actions/${actionId}/execute`, { method: 'POST' })
      onChanged()
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'The action could not be carried out.')
    }
  }

  const canAct = me.role === 'INVESTIGATOR' || me.role === 'SUPERVISOR'
  if (pending.length === 0 && !(approved.length > 0 && detail.status === 'ACTION_APPROVED')) return null
  return (
    <div className="space-y-3">
      <h3 className="font-medium">Approvals</h3>
      {pending.map((r) => {
        const own = r.actor === me.username
        return (
          <div key={r.actionId} className="space-y-2 rounded-md border p-3">
            <p>
              {r.actor} proposed <strong>{r.humanDecision.action}</strong> ({r.actionId}). This is a high-impact
              action and needs a supervisor.
            </p>
            {me.role !== 'SUPERVISOR' ? (
              <p className="text-sm text-muted-foreground">Waiting for a supervisor to approve.</p>
            ) : own ? (
              <p className="text-sm text-muted-foreground">You proposed this, so another supervisor must approve it.</p>
            ) : (
              <div className="flex gap-2">
                <Button onClick={() => decide(r.actionId, 'APPROVE')}>Approve</Button>
                <Button variant="outline" onClick={() => decide(r.actionId, 'REJECT')}>
                  Send back
                </Button>
              </div>
            )}
          </div>
        )
      })}
      {detail.status === 'ACTION_APPROVED' &&
        approved.map((r) => (
          <div key={r.actionId} className="space-y-2 rounded-md border p-3">
            <p>
              <strong>{r.humanDecision.action}</strong> is approved ({r.actionId}).
            </p>
            {canAct && <Button onClick={() => execute(r.actionId)}>Carry out (simulated)</Button>}
          </div>
        ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/** Final decision. Creates a precedent that waits for a second person's co-signature. */
export function ClosePanel({ detail, me, onChanged }: { detail: CaseDetail; me: Me; onChanged: () => void }) {
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>('CONFIRMED')
  const [reason, setReason] = useState('')
  const [rationale, setRationale] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ precedentId: string; exceptionEligible: boolean } | null>(null)
  const [key] = useState(newIdempotencyKey)

  const allowed = me.role === 'INVESTIGATOR' || me.role === 'SUPERVISOR'
  if (detail.status === 'CLOSED') {
    return (
      <p role="status">
        Closed: <strong>{detail.outcome}</strong>.
        {done && ` Precedent ${done.precedentId} is waiting for a second person to co-sign.`}
      </p>
    )
  }
  if (!allowed || !['IN_REVIEW', 'ACTION_TAKEN'].includes(detail.status)) return null

  const tooShort = rationale.trim().length < 40
  async function close() {
    setError(null)
    try {
      const res = await api<{ precedentId: string; exceptionEligible: boolean }>(`/api/cases/${detail.caseId}/close`, {
        method: 'POST',
        body: { outcome, reasonCode: reason, rationale },
        idempotencyKey: key,
      })
      setDone(res)
      onChanged()
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'The case could not be closed.')
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="font-medium">Final decision</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="outcome">Outcome</Label>
          <select
            id="outcome"
            className="h-9 w-full rounded-md border px-2"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as (typeof OUTCOMES)[number])}
          >
            {OUTCOMES.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="closeReason">Reason code</Label>
          <select
            id="closeReason"
            className="h-9 w-full rounded-md border px-2"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">Select a reason…</option>
            {REASON_CODES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="rationale">Rationale (at least 40 characters; it becomes a precedent)</Label>
        <Textarea id="rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button onClick={close} disabled={!reason || tooShort}>
        Close case
      </Button>
    </div>
  )
}
