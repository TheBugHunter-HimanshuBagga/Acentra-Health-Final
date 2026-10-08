import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ApprovalBox, ClosePanel } from '@/components/ActionBoxes'
import { BriefPanel } from '@/components/BriefPanel'
import { NetworkSection } from '@/components/case/NetworkSection'
import { ConfidenceSection, OutlookSection, PrecedentsSection, TimelineSection } from '@/components/case/Sections'
import { DecisionPanel } from '@/components/DecisionPanel'
import { money, TierBadge } from '@/components/TierBadge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { useMe } from '@/lib/auth'
import { scrollToId, ScrollReveal } from '@/lib/motion'
import type { CaseDetail, ClaimsPage, EvidencePack, ReviewRecord } from '@/lib/types'

const SECTIONS = [
  ['brief', 'Brief'],
  ['ev', 'Evidence'],
  ['cl', 'Claim lines'],
  ['tl', 'Timeline'],
  ['net', 'Network'],
  ['out', 'Outlook'],
  ['conf', 'Confidence'],
  ['prec', 'Precedents'],
  ['dec', 'Decision'],
  ['hist', 'History'],
] as const

const CHANNEL_LABEL: Record<string, string> = { LINE: 'Claim lines', PEER: 'Peer comparison', SELF: 'Own history', NETWORK: 'Network' }

function H2({ id, children }: { id: string; children: string }) {
  return <h2 id={id} className="scroll-mt-28 text-lg font-medium">{children}</h2>
}

export function CasePage() {
  const { caseId = '' } = useParams()
  const qc = useQueryClient()
  const me = useMe().data
  const [claimPage, setClaimPage] = useState(0)
  const [evidenceFilter, setEvidenceFilter] = useState<string | null>(null)
  const [channel, setChannel] = useState<string | null>(null)

  const detail = useQuery<CaseDetail>({ queryKey: ['case', caseId], queryFn: () => api(`/api/cases/${caseId}`) })
  const pack = useQuery<EvidencePack>({ queryKey: ['evidence', caseId], queryFn: () => api(`/api/cases/${caseId}/evidence`) })
  const claims = useQuery<ClaimsPage>({
    queryKey: ['claims', caseId, claimPage, evidenceFilter],
    queryFn: () => api(`/api/cases/${caseId}/claims?page=${claimPage}&size=10${evidenceFilter ? `&evidenceId=${evidenceFilter}` : ''}`),
  })
  const reviews = useQuery<ReviewRecord[]>({ queryKey: ['reviews', caseId], queryFn: () => api(`/api/cases/${caseId}/reviews`) })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['case', caseId] })
    void qc.invalidateQueries({ queryKey: ['reviews', caseId] })
    void qc.invalidateQueries({ queryKey: ['queue'] })
    void qc.invalidateQueries({ queryKey: ['precedents'] })
  }

  if (detail.isError) return <p role="alert">This case could not be found.</p>
  if (!detail.data || !me) return <p>Loading case…</p>
  const d = detail.data
  const channels = Array.from(new Set(pack.data?.evidence.map((e) => e.channel) ?? []))
  const shown = pack.data?.evidence.filter((e) => !channel || e.channel === channel) ?? []

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
          <strong>{money(d.dollars.exact)}</strong> exact
          {d.dollars.estimated > 0 && (
            <>
              {' '}
              + <strong>{money(d.dollars.estimated)}</strong> estimated
            </>
          )}{' '}
          · {d.memberCount} members · about {d.estHours.toFixed(1)} h
        </p>
        <p className="text-sm">Patterns observed: {d.hypotheses.map((h) => h.text).join('; ')}.</p>
        <ul className="list-disc pl-5 text-sm" aria-label="Why this tier">
          {d.tierReasons.map((r) => (
            <li key={r.id}>{r.text}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          These are indicators that need human review, not findings.
          {d.outlook?.available && d.outlook.horizons && ` Model outlook for the next 90 days: ${Math.round(d.outlook.horizons['90'].probability * 100)}% (an estimate, not evidence).`}
        </p>
        <nav aria-label="Sections" className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto bg-background/90 px-1 py-2 backdrop-blur">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-full border px-3 py-1 text-xs hover:bg-muted"
              onClick={(e) => {
                e.preventDefault()
                scrollToId(id)
              }}>
              {label}
            </a>
          ))}
        </nav>
      </header>

      <ScrollReveal>
      <section aria-labelledby="brief" className="space-y-2">
        <H2 id="brief">Investigation brief</H2>
        <BriefPanel caseId={caseId} me={me} />
      </section>
      </ScrollReveal>

      <ScrollReveal>
      <section aria-labelledby="ev" className="space-y-2">
        <H2 id="ev">Evidence</H2>
        {channels.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter evidence by kind">
            <Button size="sm" variant={channel === null ? 'secondary' : 'outline'} aria-pressed={channel === null} onClick={() => setChannel(null)}>All</Button>
            {channels.map((c) => (
              <Button key={c} size="sm" variant={channel === c ? 'secondary' : 'outline'} aria-pressed={channel === c} onClick={() => setChannel(channel === c ? null : c)}>
                {CHANNEL_LABEL[c] ?? c}
              </Button>
            ))}
          </div>
        )}
        {shown.map((e) => (
          <div key={e.id} className="surface p-3">
            <p>
              <strong>{e.id}</strong> · {e.detector} · {CHANNEL_LABEL[e.channel] ?? e.channel}
              {e.hardFact ? ' · direct fact' : ''}
              {e.dollarsBasis === 'ESTIMATED' ? ' · estimated dollars' : ''}
            </p>
            <p>{e.statement}</p>
            <p className="text-sm text-muted-foreground">
              {money(e.dollars)} on {e.lineCount} lines · policy {e.policyRefs.join(', ')}
            </p>
            {e.lineCount > 0 && (
              <Button size="sm" variant="link" className="px-0" onClick={() => { setEvidenceFilter(evidenceFilter === e.id ? null : e.id); setClaimPage(0); scrollToId('cl') }}>
                {evidenceFilter === e.id ? 'Show all claim lines' : `Show the ${e.lineCount} claim lines`}
              </Button>
            )}
          </div>
        ))}
        {pack.data && pack.data.policies.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer">Policies cited ({pack.data.policies.length})</summary>
            <ul className="mt-2 space-y-1">
              {pack.data.policies.map((p) => <li key={p.id}><strong>{p.id}</strong> {p.title}: {p.text}</li>)}
            </ul>
          </details>
        )}
        {pack.data && (
          <ul className="list-disc pl-5 text-sm">
            {pack.data.limitations.map((l) => (
              <li key={l.id}>{l.text}</li>
            ))}
          </ul>
        )}
      </section>
      </ScrollReveal>

      <ScrollReveal>
      <section aria-labelledby="cl" className="space-y-2">
        <H2 id="cl">Claim lines</H2>
        {evidenceFilter && <p className="text-sm">Showing only lines for {evidenceFilter}.</p>}
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
      </ScrollReveal>

      <ScrollReveal>
      <section aria-labelledby="tl" className="space-y-2">
        <H2 id="tl">Timeline</H2>
        <TimelineSection caseId={caseId} />
      </section>
      </ScrollReveal>

      <ScrollReveal>
      <section aria-labelledby="net" className="space-y-2">
        <H2 id="net">Network</H2>
        <NetworkSection caseId={caseId} />
      </section>
      </ScrollReveal>

      <ScrollReveal>
      <section aria-labelledby="out" className="space-y-2">
        <H2 id="out">30, 60 and 90 day outlook</H2>
        <OutlookSection outlook={d.outlook} />
      </section>
      </ScrollReveal>

      <ScrollReveal>
      <section aria-labelledby="conf" className="space-y-2">
        <H2 id="conf">Confidence</H2>
        <ConfidenceSection detail={d} pack={pack.data} />
      </section>
      </ScrollReveal>

      <ScrollReveal>
      <section aria-labelledby="prec" className="space-y-2">
        <H2 id="prec">Similar past cases</H2>
        <PrecedentsSection caseId={caseId} />
      </section>
      </ScrollReveal>

      <ScrollReveal>
      <section aria-labelledby="dec" className="space-y-4">
        <H2 id="dec">Decision</H2>
        <DecisionPanel detail={d} me={me} onChanged={refresh} />
        {reviews.data && <ApprovalBox reviews={reviews.data} detail={d} me={me} onChanged={refresh} />}
        <ClosePanel detail={d} me={me} onChanged={refresh} />
      </section>
      </ScrollReveal>

      <ScrollReveal>
      <section aria-labelledby="hist" className="space-y-2">
        <H2 id="hist">History</H2>
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
      </ScrollReveal>
    </article>
  )
}
