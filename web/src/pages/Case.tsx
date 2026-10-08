import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ApprovalBox, ClosePanel } from '@/components/ActionBoxes'
import { BriefPanel } from '@/components/BriefPanel'
import { NetworkSection } from '@/components/case/NetworkSection'
import { ConfidenceSection, OutlookSection, TimelineSection } from '@/components/case/Sections'
import { ImpactGrid, ReasoningChain, Triad } from '@/components/insight/ConfidenceViews'
import { AiReasoning, ExplanationCard } from '@/components/insight/WhyFlagged'
import { FeedbackPanel, InstitutionalMemory, KnowledgePanel } from '@/components/insight/LearningViews'
import { DecisionPanel } from '@/components/DecisionPanel'
import { ProvChip, ProvLegend } from '@/components/Provenance'
import { money, TierBadge } from '@/components/TierBadge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { useMe } from '@/lib/auth'
import { AnimatedBar, ScrollReveal, scrollToId } from '@/lib/motion'
import type { CaseDetail, ClaimsPage, EvidenceItem, EvidencePack, ReviewRecord } from '@/lib/types'

const SECTIONS = [
  ['triad', 'Confidence'],
  ['why', 'Why this case'],
  ['impact', 'Impact'],
  ['brief', 'Brief'],
  ['ev', 'Evidence'],
  ['cl', 'Claim lines'],
  ['tl', 'Timeline'],
  ['net', 'Network'],
  ['prec', 'Memory'],
  ['hist', 'History'],
  ['out', 'Outlook'],
  ['conf', 'Confidence detail'],
  ['dec', 'Decision'],
] as const

const CHANNEL_LABEL: Record<string, string> = { LINE: 'Claim lines', PEER: 'Peer comparison', SELF: 'Own history', NETWORK: 'Network' }

function H2({ id, eyebrow, children }: { id: string; eyebrow?: string; children: string }) {
  return (
    <div className="space-y-0.5">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2 id={id} className="scroll-mt-24 text-xl font-semibold">{children}</h2>
    </div>
  )
}

function EvidenceRow({ e, active, onLines }: { e: EvidenceItem; active: boolean; onLines: () => void }) {
  return (
    <li className="space-y-2 border-b py-4 first:border-t">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-xs font-medium">{e.id}</span>
        <ProvChip kind={e.hardFact ? 'fact' : 'signal'} />
        <span className="eyebrow">{CHANNEL_LABEL[e.channel] ?? e.channel}</span>
        <span className="eyebrow opacity-70">{e.detector}</span>
        {e.hardFact && <span className="eyebrow">direct fact</span>}
        {e.dollarsBasis === 'ESTIMATED' && <span className="eyebrow">estimated dollars</span>}
      </div>
      <p className="text-[0.95rem] leading-relaxed">{e.statement}</p>
      <p className="text-xs text-muted-foreground">
        <span className="num">{money(e.dollars)}</span> on {e.lineCount} lines · policy {e.policyRefs.join(', ')}
      </p>
      {e.lineCount > 0 && (
        <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={onLines}>
          {active ? 'Show all claim lines' : `Show the ${e.lineCount} claim lines`}
        </Button>
      )}
      {e.observation && (
        <details className="text-xs text-muted-foreground">
          <summary className="eyebrow cursor-pointer select-none hover:text-foreground">Observed, threshold and sources</summary>
          <dl className="mt-2 grid gap-1 md:grid-cols-[8rem_1fr]">
            <dt>Threshold</dt><dd className="text-foreground">{e.observation.threshold}</dd>
            {e.observation.observed && (<><dt>Observed</dt><dd className="mono text-foreground">{JSON.stringify(e.observation.observed)}</dd></>)}
            {e.observation.peerBaseline && (<><dt>Peer baseline</dt><dd className="mono text-foreground">{JSON.stringify(e.observation.peerBaseline)}</dd></>)}
            {e.observation.history && (<><dt>History</dt><dd className="mono text-foreground">{JSON.stringify(e.observation.history)}</dd></>)}
            {e.observation.network && (<><dt>Network</dt><dd className="mono text-foreground">{JSON.stringify(e.observation.network)}</dd></>)}
            <dt>Source fields</dt><dd className="mono text-foreground">{e.observation.sourceFields.join(', ')}</dd>
          </dl>
        </details>
      )}
    </li>
  )
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
  if (!detail.data || !me) {
    return (
      <div className="grid gap-6 xl:grid-cols-[18rem_1fr_22rem]" aria-busy="true">
        {[0, 1, 2].map((i) => <div key={i} className="h-96 animate-pulse rounded-xl bg-muted" />)}
      </div>
    )
  }
  const d = detail.data
  const channels = Array.from(new Set(pack.data?.evidence.map((e) => e.channel) ?? []))
  const shown = pack.data?.evidence.filter((e) => !channel || e.channel === channel) ?? []
  const strong = Object.values(d.channels ?? {}).filter((v) => v >= 0.65).length
  const f = d.factors
  const rail = 'xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:self-start xl:overflow-y-auto xl:pr-1'

  return (
    <article className="grid gap-x-10 gap-y-8 xl:grid-cols-[17rem_minmax(0,1fr)_21rem]">
      {/* ---------------------------------------------------------------- LEFT: identity */}
      <aside className={`space-y-5 ${rail}`} aria-label="Case identity">
        <div className="space-y-3">
          <p className="eyebrow">Investigation</p>
          <h1 className="display text-4xl">{d.caseId}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge tier={d.tier} />
            {strong >= 2 && <span className="chip chip-corr">{strong} channels agree</span>}
          </div>
          <p className="text-sm text-muted-foreground">Status: {d.status}</p>
        </div>

        <dl className="space-y-3 border-y py-4 text-sm">
          <div>
            <dt className="eyebrow">Potential dollars</dt>
            <dd className="bignum mt-1 text-3xl"><span className="sr-only">Subjects: {d.subjects.map((s) => `${s.id} (${s.role.toLowerCase()})`).join(', ')} · </span>{money(d.dollars.exact + d.dollars.estimated)}</dd>
            <dd className="text-xs text-muted-foreground">
              <strong>{money(d.dollars.exact)}</strong> exact
              {d.dollars.estimated > 0 && <> + <strong>{money(d.dollars.estimated)}</strong> estimated</>}
            </dd>
          </div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Members</dt><dd className="num">{d.memberCount}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Effort</dt><dd className="num">about {d.estHours.toFixed(1)} h</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Alerts</dt><dd className="num">{d.alertCount ?? '—'}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Billing window</dt><dd className="num text-xs">{d.firstServiceDt ?? '—'} → {d.lastServiceDt ?? '—'}</dd></div>
        </dl>

        <div className="space-y-2">
          <p className="eyebrow">Subjects</p>
          <ul className="space-y-1.5 text-sm">
            {d.subjects.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-2">
                <span><span className="mono text-xs">{s.id}</span> <span className="text-muted-foreground">({s.role.toLowerCase()})</span></span>
                <span className="truncate text-xs text-muted-foreground">{s.specialty}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <p className="eyebrow">Ranking factors</p>
          <ul className="space-y-1.5">
            {([['Risk', f.risk], ['Member impact', f.memberImpact], ['Severity', f.severity], ['Evidence', f.evidenceStrength]] as const).map(([l, v]) => (
              <li key={l} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-xs">
                <span className="text-muted-foreground">{l}</span>
                <span className="h-1 rounded bg-muted"><AnimatedBar value={v} className="bg-[var(--signal)]" /></span>
                <span className="num text-right">{v.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <p className="eyebrow">Summary</p>
          <p className="text-sm">Patterns observed: {d.hypotheses.map((h) => h.text).join('; ')}.</p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground" aria-label="Why this tier">
            {d.tierReasons.map((r) => (
              <li key={r.id}>{r.text}</li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">These are indicators that need human review, not findings.</p>

        <nav aria-label="Sections" className="hidden space-y-0.5 border-t pt-4 xl:block">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="block rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(e) => { e.preventDefault(); scrollToId(id) }}>
              {label}
            </a>
          ))}
        </nav>
      </aside>

      {/* ------------------------------------------------------------- CENTER: the narrative */}
      <div className="min-w-0 space-y-14">
        <nav aria-label="Sections (compact)" className="sticky top-14 z-10 -mx-1 flex gap-1 overflow-x-auto bg-background/90 px-1 py-2 backdrop-blur xl:hidden">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-full border px-3 py-1 text-xs hover:bg-muted"
              onClick={(e) => { e.preventDefault(); scrollToId(id) }}>
              {label}
            </a>
          ))}
        </nav>

        <ProvLegend />

        {pack.data?.confidence && (
          <ScrollReveal>
            <div id="triad" className="scroll-mt-24"><Triad c={pack.data.confidence} /></div>
          </ScrollReveal>
        )}

        {pack.data?.explanation && pack.data.reasoning && (
          <ScrollReveal>
            <section aria-labelledby="why-h" className="space-y-6">
              <div id="why" className="scroll-mt-24 space-y-0.5">
                <p className="eyebrow">Flagged or not, always explained</p>
                <h2 id="why-h" className="text-xl font-semibold">Why this case?</h2>
              </div>
              <ExplanationCard x={pack.data.explanation} />
              <ReasoningChain steps={pack.data.reasoning.steps} note={pack.data.reasoning.note} />
              <div className="panel p-5"><AiReasoning caseId={caseId} me={me} /></div>
            </section>
          </ScrollReveal>
        )}

        {pack.data?.impact && (
          <ScrollReveal>
            <div id="impact" className="scroll-mt-24"><ImpactGrid impact={pack.data.impact} /></div>
          </ScrollReveal>
        )}

        <ScrollReveal>
          <section aria-labelledby="brief" className="space-y-4">
            <H2 id="brief" eyebrow="What happened and why it matters">Investigation brief</H2>
            <BriefPanel caseId={caseId} me={me} />
          </section>
        </ScrollReveal>

        <ScrollReveal>
          <section aria-labelledby="ev" className="space-y-4">
            <H2 id="ev" eyebrow="What supports it">Evidence</H2>
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
            <ul>
              {shown.map((e) => (
                <EvidenceRow
                  key={e.id}
                  e={e}
                  active={evidenceFilter === e.id}
                  onLines={() => {
                    setEvidenceFilter(evidenceFilter === e.id ? null : e.id)
                    setClaimPage(0)
                    scrollToId('cl')
                  }}
                />
              ))}
            </ul>
            {pack.data && pack.data.policies.length > 0 && (
              <details className="text-sm">
                <summary className="eyebrow cursor-pointer">Policies cited ({pack.data.policies.length})</summary>
                <ul className="mt-2 space-y-1">
                  {pack.data.policies.map((p) => <li key={p.id}><strong>{p.id}</strong> {p.title}: {p.text}</li>)}
                </ul>
              </details>
            )}
            {pack.data && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {pack.data.limitations.map((l) => (
                  <li key={l.id}>{l.text}</li>
                ))}
              </ul>
            )}
          </section>
        </ScrollReveal>

        <ScrollReveal>
          <section aria-labelledby="cl" className="space-y-4">
            <H2 id="cl" eyebrow="The billed services behind the evidence">Claim lines</H2>
            {evidenceFilter && <p className="text-sm">Showing only lines for {evidenceFilter}.</p>}
            {claims.data && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="eyebrow">Evidence</TableHead>
                      <TableHead className="eyebrow">Claim</TableHead>
                      <TableHead className="eyebrow">Date</TableHead>
                      <TableHead className="eyebrow">Service</TableHead>
                      <TableHead className="eyebrow">Units</TableHead>
                      <TableHead className="eyebrow text-right">Paid</TableHead>
                      <TableHead className="eyebrow">Flag</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {claims.data.items.map((c) => (
                      <TableRow key={`${c.evidenceId}-${c.claimId}-${c.lineNo}`} className="row-hover">
                        <TableCell className="mono text-xs">{c.evidenceId}</TableCell>
                        <TableCell className="mono text-xs">{c.claimId}:{c.lineNo}</TableCell>
                        <TableCell className="num">{c.serviceDt}</TableCell>
                        <TableCell>{c.hcpcs} {c.label}</TableCell>
                        <TableCell className="num">{c.units}</TableCell>
                        <TableCell className="num text-right">{money(c.paid)}</TableCell>
                        <TableCell className="mono text-xs text-[var(--warn)]">{c.flagRole}</TableCell>
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
                  <Button variant="outline" size="sm" disabled={(claimPage + 1) * claims.data.size >= claims.data.total} onClick={() => setClaimPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </>
            )}
          </section>
        </ScrollReveal>

        <ScrollReveal>
          <section aria-labelledby="tl" className="space-y-4">
            <H2 id="tl" eyebrow="When it happened">Timeline</H2>
            <TimelineSection caseId={caseId} />
          </section>
        </ScrollReveal>

        <ScrollReveal>
          <section aria-labelledby="net" className="space-y-4">
            <H2 id="net" eyebrow="Who and what is connected">Network</H2>
            <NetworkSection caseId={caseId} />
          </section>
        </ScrollReveal>

        <ScrollReveal>
          <section aria-labelledby="prec" className="space-y-4">
            <H2 id="prec" eyebrow="Institutional memory">Similar past cases</H2>
            <InstitutionalMemory caseId={caseId} me={me} />
          </section>
        </ScrollReveal>

        <ScrollReveal>
          <section aria-labelledby="hist" className="space-y-4">
            <div className="flex flex-wrap items-center gap-3"><H2 id="hist" eyebrow="Accountability">History</H2><ProvChip kind="human" /></div>
            {reviews.data && reviews.data.length === 0 && <p className="text-sm">No decisions recorded yet.</p>}
            <ol className="relative space-y-4 border-l pl-5 text-sm">
              {reviews.data?.map((r) => (
                <li key={r.actionId} className="relative">
                  <span aria-hidden className="absolute -left-[1.55rem] top-1.5 h-2 w-2 rounded-full border-2 border-foreground bg-background" />
                  <span className="mono text-xs text-muted-foreground">{r.createdAt.slice(0, 19).replace('T', ' ')}</span>
                  <p>
                    {r.actor} ({r.role}) {r.action}
                    {r.humanDecision.action ? ` → ${r.humanDecision.action}` : ''}
                    {r.reasonCode ? ` [${r.reasonCode}]` : ''} · {r.status}
                    {r.approver ? ` · approved by ${r.approver}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </ScrollReveal>
      </div>

      {/* ------------------------------------------------------- RIGHT: signals and the decision */}
      <aside className={`space-y-10 ${rail}`} aria-label="Signals and decision">
        <section aria-labelledby="out" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2"><H2 id="out" eyebrow="Where to look next">30, 60 and 90 day outlook</H2><ProvChip kind="prediction" /></div>
          <OutlookSection outlook={d.outlook} />
        </section>

        <section aria-labelledby="conf" className="space-y-3">
          <H2 id="conf" eyebrow="How sure are we">Confidence</H2>
          <ConfidenceSection detail={d} pack={pack.data} />
        </section>

        <section aria-labelledby="dec" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><H2 id="dec" eyebrow="Your call">Decision</H2><ProvChip kind="human" /></div>
          <DecisionPanel detail={d} me={me} onChanged={refresh} />
          {reviews.data && <ApprovalBox reviews={reviews.data} detail={d} me={me} onChanged={refresh} />}
          <ClosePanel detail={d} me={me} onChanged={refresh} />
          <KnowledgePanel caseId={caseId} status={d.status} me={me} />
          <FeedbackPanel caseId={caseId} me={me} />
        </section>
      </aside>
    </article>
  )
}
