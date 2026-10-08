import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ApprovalBox, ClosePanel } from '@/components/ActionBoxes'
import { BriefPanel } from '@/components/BriefPanel'
import { DecisionPanel } from '@/components/DecisionPanel'
import { money, TierBadge } from '@/components/TierBadge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { useMe } from '@/lib/auth'
import type { CaseDetail, ClaimsPage, EvidencePack, ReviewRecord } from '@/lib/types'

export function CasePage() {
  const { caseId = '' } = useParams()
  const qc = useQueryClient()
  const me = useMe().data
  const [claimPage, setClaimPage] = useState(0)

  const detail = useQuery<CaseDetail>({ queryKey: ['case', caseId], queryFn: () => api(`/api/cases/${caseId}`) })
  const pack = useQuery<EvidencePack>({ queryKey: ['evidence', caseId], queryFn: () => api(`/api/cases/${caseId}/evidence`) })
  const claims = useQuery<ClaimsPage>({
    queryKey: ['claims', caseId, claimPage],
    queryFn: () => api(`/api/cases/${caseId}/claims?page=${claimPage}&size=10`),
  })
  const reviews = useQuery<ReviewRecord[]>({ queryKey: ['reviews', caseId], queryFn: () => api(`/api/cases/${caseId}/reviews`) })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['case', caseId] })
    void qc.invalidateQueries({ queryKey: ['reviews', caseId] })
    void qc.invalidateQueries({ queryKey: ['queue'] })
  }

  if (detail.isError) return <p role="alert">This case could not be found.</p>
  if (!detail.data || !me) return <p>Loading case…</p>
  const d = detail.data

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{d.caseId}</h1>
          <TierBadge tier={d.tier} />
          <span className="text-sm text-muted-foreground">Status: {d.status}</span>
        </div>
        <p>
          Subjects: {d.subjects.map((s) => `${s.id} (${s.role.toLowerCase()})`).join(', ')} ·{' '}
          <strong>{money(d.dollars.exact)}</strong> exact · {d.memberCount} members · about {d.estHours.toFixed(1)} h
        </p>
        <p className="text-sm">Patterns observed: {d.hypotheses.map((h) => h.text).join('; ')}.</p>
        <ul className="list-disc pl-5 text-sm" aria-label="Why this tier">
          {d.tierReasons.map((r) => (
            <li key={r.id}>{r.text}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          These are indicators that need human review, not findings. 30/60/90-day outlook: not available in this build.
        </p>
      </header>

      <section aria-labelledby="brief" className="space-y-2">
        <h2 id="brief" className="text-lg font-medium">Investigation brief</h2>
        <BriefPanel caseId={caseId} me={me} />
      </section>

      <section aria-labelledby="ev" className="space-y-2">
        <h2 id="ev" className="text-lg font-medium">Evidence</h2>
        {pack.data?.evidence.map((e) => (
          <div key={e.id} className="rounded-md border p-3">
            <p>
              <strong>{e.id}</strong> · {e.detector} · {e.channel}
              {e.hardFact ? ' · direct fact' : ''}
            </p>
            <p>{e.statement}</p>
            <p className="text-sm text-muted-foreground">
              {money(e.dollars)} on {e.lineCount} lines · policy {e.policyRefs.join(', ')}
            </p>
          </div>
        ))}
        {pack.data && (
          <ul className="list-disc pl-5 text-sm">
            {pack.data.limitations.map((l) => (
              <li key={l.id}>{l.text}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cl" className="space-y-2">
        <h2 id="cl" className="text-lg font-medium">Claim lines</h2>
        {claims.data && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Claim</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Units</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Flag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.data.items.map((c) => (
                  <TableRow key={`${c.evidenceId}-${c.claimId}-${c.lineNo}`}>
                    <TableCell>{c.evidenceId}</TableCell>
                    <TableCell>{c.claimId}:{c.lineNo}</TableCell>
                    <TableCell>{c.serviceDt}</TableCell>
                    <TableCell>{c.hcpcs} {c.label}</TableCell>
                    <TableCell>{c.units}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(c.paid)}</TableCell>
                    <TableCell>{c.flagRole}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={claimPage === 0} onClick={() => setClaimPage((p) => p - 1)}>
                Previous
              </Button>
              <span>
                Page {claimPage + 1} of {Math.max(1, Math.ceil(claims.data.total / claims.data.size))} ({claims.data.total} lines)
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={(claimPage + 1) * claims.data.size >= claims.data.total}
                onClick={() => setClaimPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="dec" className="space-y-4">
        <h2 id="dec" className="text-lg font-medium">Decision</h2>
        <DecisionPanel detail={d} me={me} onChanged={refresh} />
        {reviews.data && <ApprovalBox reviews={reviews.data} detail={d} me={me} onChanged={refresh} />}
        <ClosePanel detail={d} me={me} onChanged={refresh} />
      </section>

      <section aria-labelledby="hist" className="space-y-2">
        <h2 id="hist" className="text-lg font-medium">History</h2>
        {reviews.data && reviews.data.length === 0 && <p className="text-sm">No decisions recorded yet.</p>}
        <ul className="space-y-1 text-sm">
          {reviews.data?.map((r) => (
            <li key={r.actionId}>
              {r.createdAt.slice(0, 19).replace('T', ' ')} · {r.actor} ({r.role}) {r.action}
              {r.humanDecision.action ? ` → ${r.humanDecision.action}` : ''}
              {r.reasonCode ? ` [${r.reasonCode}]` : ''} · {r.status}
              {r.approver ? ` · approved by ${r.approver}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </article>
  )
}
