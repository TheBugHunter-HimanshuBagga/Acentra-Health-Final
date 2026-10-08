import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, ApiError } from '@/lib/api'
import { useMe } from '@/lib/auth'
import type { Precedent } from '@/lib/types2'

const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', PENDING_COSIGN: 'Waiting for co-sign', RETIRED: 'Retired' }

/** Second Brain: what past closed cases taught the system. A supervisor's co-sign is what makes a closure a precedent. */
export function PrecedentsPage() {
  const me = useMe().data
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const q = useQuery<Precedent[]>({ queryKey: ['precedents', status], queryFn: () => api(`/api/precedents${status ? `?status=${status}` : ''}`) })

  const cosign = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'CONFIRM' | 'REJECT' }) =>
      api<{ status: string; conflicts?: unknown[]; reinforces?: unknown[] }>(`/api/precedents/${id}/cosign`, { method: 'POST', body: { decision } }),
    onSuccess: (r, v) => {
      setError(null)
      setMessage(v.decision === 'CONFIRM' ? `${v.id} is now an active precedent. The queue is being re-run so cases can use it.` : `${v.id} was not accepted as a precedent.`)
      void qc.invalidateQueries({ queryKey: ['precedents'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      void qc.invalidateQueries({ queryKey: ['jobs'] })
      return r
    },
    onError: (e) => setError(e instanceof ApiError ? e.detail : 'The co-sign could not be recorded.'),
  })

  const propose = useMutation({
    mutationFn: (p: Precedent) => api<{ excId: string }>('/api/exceptions/propose', { method: 'POST', body: { caseId: p.caseId, precedentId: p.precedentId } }),
    onSuccess: (r) => navigate(`/governance?exc=${r.excId}`),
    onError: (e) => setError(e instanceof ApiError ? e.detail : 'The exception could not be drafted.'),
  })

  const rows = q.data ?? []
  const pending = rows.filter((p) => p.status === 'PENDING_COSIGN')
  const canCosign = me?.role === 'SUPERVISOR'

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Precedents</h1>
        <p className="text-sm text-muted-foreground">
          Every closed case can teach the system, but only after a second person (a supervisor) co-signs it. Active precedents are shown next to similar new cases.
          Precedents never change a tier by themselves except to hold back cases that closely resemble several unfounded ones.
        </p>
      </header>
      {message && <p role="status" className="text-sm">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {pending.length > 0 && (
        <section className="surface space-y-2 p-4" aria-labelledby="pend-h">
          <h2 id="pend-h" className="font-medium">Waiting for a supervisor ({pending.length})</h2>
          <ul className="space-y-3">
            {pending.map((p) => (
              <li key={p.precedentId} className="space-y-1 text-sm">
                <p>
                  <span className="mono">{p.precedentId}</span> · {p.caseId && <Link className="underline" to={`/cases/${p.caseId}`}>{p.caseId}</Link>} · {p.schemeType} · closed{' '}
                  <strong>{p.disposition}</strong> ({p.reasonCode}) by {p.createdBy}
                </p>
                {p.rationale && <p className="text-muted-foreground">{p.rationale}</p>}
                {canCosign ? (
                  <div className="flex gap-2">
                    <Button size="sm" disabled={cosign.isPending} onClick={() => cosign.mutate({ id: p.precedentId, decision: 'CONFIRM' })}>Co-sign as precedent</Button>
                    <Button size="sm" variant="outline" disabled={cosign.isPending} onClick={() => cosign.mutate({ id: p.precedentId, decision: 'REJECT' })}>Do not accept</Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Only a supervisor other than the person who closed the case can co-sign.</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center gap-3">
        <label htmlFor="pstatus" className="text-sm">Show</label>
        <select id="pstatus" className="h-9 rounded-md border bg-background px-2" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING_COSIGN">Waiting for co-sign</option>
          <option value="RETIRED">Retired</option>
        </select>
        <span className="text-sm text-muted-foreground">{rows.length} precedents</span>
      </div>
      {q.isError && <p role="alert">Precedents could not be loaded.</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Scheme</TableHead>
            <TableHead>Specialty</TableHead>
            <TableHead>Closed as</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.precedentId}>
              <TableCell className="mono text-xs">{p.precedentId}</TableCell>
              <TableCell>{p.source === 'LIVE' ? 'Reviewer' : 'Seed'}</TableCell>
              <TableCell>{p.schemeType}</TableCell>
              <TableCell>{p.specialtyCode ?? ''}</TableCell>
              <TableCell>{p.disposition}</TableCell>
              <TableCell>{p.reasonCode ?? ''}</TableCell>
              <TableCell>{STATUS_LABEL[p.status] ?? p.status}</TableCell>
              <TableCell>
                {p.source === 'LIVE' && p.status === 'ACTIVE' && p.disposition === 'UNFOUNDED' && p.caseId && me && me.role !== 'AUDITOR' && me.role !== 'GOVERNANCE' && (
                  <Button size="sm" variant="outline" disabled={propose.isPending} onClick={() => propose.mutate(p)}>Propose exception</Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
