// The investigation inspector: it builds the story around whatever is selected, from the evidence pack, the stored
// graph and the flagged claim lines. Progressive disclosure: the first block is open, the rest are one click away.
import { Building2, ChevronRight, FileText, Hospital, ShieldAlert, Stethoscope, User } from 'lucide-react'
import type { ReactNode } from 'react'
import type { CaseDetail, ClaimLine, EvidencePack } from '@/lib/types'
import type { CaseTimeline } from '@/lib/types2'
import { NetworkReading } from './NetworkReading'
import { KIND_LABEL, type EntityType, type GEdge, type GNode, type Model, type Selection, briefFor, shortestPath } from './model'

const ICON = { provider: Stethoscope, owner: Building2, member: User, claim: FileText, facility: Hospital }
const COLOR: Record<EntityType, string> = { provider: 'var(--chart-2)', owner: 'var(--chart-4)', member: 'var(--chart-1)', claim: 'var(--chart-3)', facility: 'var(--chart-5)' }
const RISK_COLOR = { HIGH: 'var(--tier-high)', MEDIUM: 'var(--tier-medium)', LOW: 'var(--tier-monitor)', MONITOR: 'var(--tier-monitor)' } as const
const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`

export interface InspectorCtx {
  model: Model
  pack?: EvidencePack
  detail?: CaseDetail
  timeline?: CaseTimeline
  lines: ClaimLine[]
  selection: Selection
  onSelect: (s: Selection) => void
  onFocus: (ids: string[]) => void
  onAsk: (q: string) => void
  /** simulation: the current risk value shown in the header, when running */
  simRisk?: number | null
  visible?: Set<string>
  canGenerate?: boolean
}

function Block({ title, children, open = false, count }: { title: string; children: ReactNode; open?: boolean; count?: number | string }) {
  return (
    <details open={open} className="group border-t first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-xs font-medium text-foreground marker:hidden hover:text-primary [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 group-open:rotate-90" />
        <span className="eyebrow !text-foreground">{title}</span>
        {count != null && <span className="ml-auto mono text-[0.65rem] text-muted-foreground">{count}</span>}
      </summary>
      <div className="space-y-2 pb-4 pl-5 text-[13px] leading-relaxed">{children}</div>
    </details>
  )
}

function KV({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={`text-right text-foreground ${mono ? 'mono text-xs' : ''}`}>{v}</dd>
    </div>
  )
}

function Chip({ children, onClick, title }: { children: ReactNode; onClick?: () => void; title?: string }) {
  return (
    <button type="button" title={title} onClick={onClick} className="mono inline-flex items-center rounded-full border px-2 py-0.5 text-[0.68rem] transition hover:border-[var(--signal)] hover:bg-muted">
      {children}
    </button>
  )
}

function Header({ node, edge, simRisk }: { node?: GNode; edge?: GEdge; simRisk?: number | null }) {
  if (node) {
    const Icon = ICON[node.type]
    return (
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${COLOR[node.type]} 16%, transparent)` }}>
          <Icon aria-hidden className="h-5 w-5" style={{ color: COLOR[node.type] }} />
        </span>
        <div className="min-w-0">
          <p className="eyebrow">{node.caption}</p>
          <h2 className="mono text-lg font-semibold leading-tight">{node.id}</h2>
          {node.risk && (
            <p className="mt-1 text-xs font-medium" style={{ color: RISK_COLOR[node.risk.level] }}>
              {node.risk.level} risk · {(simRisk ?? node.risk.score).toFixed(2)}
            </p>
          )}
        </div>
      </div>
    )
  }
  if (edge) {
    return (
      <div>
        <p className="eyebrow">Relationship</p>
        <h2 className="text-lg font-semibold leading-tight">{KIND_LABEL[edge.kind]}</h2>
        <p className="mono mt-1 text-xs text-muted-foreground">{edge.source} → {edge.target}</p>
      </div>
    )
  }
  return null
}

export function Inspector({ ctx }: { ctx: InspectorCtx }) {
  const { model, pack, detail, timeline, selection, onSelect, onFocus, onAsk, simRisk } = ctx
  const node = selection.kind === 'node' ? model.nodes.get(selection.id!) : undefined
  const edge = selection.kind === 'edge' ? model.edges.find((e) => e.id === selection.id) : undefined
  const brief = briefFor({ model, pack, detail, selection, visible: ctx.visible })
  const primary = model.primary[0]
  const evidence = pack?.evidence ?? []

  const neighborsOf = (id: string, type?: EntityType) => [...(model.adjacency.get(id) ?? [])].map((i) => model.nodes.get(i)!).filter((n) => n && (!type || n.type === type))
  const claimsOf = (providerId: string) => neighborsOf(providerId, 'claim')
  const events = (id: string) => (timeline?.events ?? []).filter((e) => e.entity === id)

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 border-b p-4">
        {node || edge ? <Header node={node} edge={edge} simRisk={simRisk} /> : (
          <div>
            <p className="eyebrow">Investigation</p>
            <h2 className="text-lg font-semibold leading-tight">{model.caseId}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Select an entity or a link. The inspector builds the story around it.</p>
          </div>
        )}
        {/* the copilot's reading of the current selection */}
        <div className="rounded-xl border bg-muted/40 p-3">
          <p className="eyebrow flex items-center gap-1.5"><ShieldAlert aria-hidden className="h-3 w-3" /> Copilot reading</p>
          <p className="mt-1.5 text-[13px] leading-relaxed">{brief.text}</p>
          {brief.citations.length > 0 && <p className="mono mt-1.5 flex flex-wrap gap-1 text-[0.62rem] text-muted-foreground">{brief.citations.map((c) => <span key={c} className="rounded border px-1">{c}</span>)}</p>}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {brief.suggestions.slice(0, 4).map((s) => <Chip key={s} onClick={() => onAsk(s)}>{s}</Chip>)}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        {/* ----------------------------------------------------------------------------------- nothing selected */}
        {!node && !edge && (
          <>
            <Block title="Case" open>
              <dl className="space-y-1.5">
                <KV k="Tier" v={detail?.tier ?? '-'} />
                <KV k="Status" v={detail?.status?.replace(/_/g, ' ').toLowerCase() ?? '-'} />
                <KV k="Exposure" v={detail ? `${usd(detail.dollars.exact)} exact, ${usd(detail.dollars.estimated)} estimated` : '-'} />
                <KV k="Members" v={detail?.memberCount ?? '-'} />
                <KV k="Entities in view" v={model.nodes.size} />
              </dl>
            </Block>
            <Block title="Evidence" count={evidence.length} open>
              <ul className="space-y-2">
                {evidence.map((e) => (
                  <li key={e.id} className="rounded-lg border p-2.5">
                    <p className="flex items-center gap-2"><span className="mono text-[0.68rem] text-muted-foreground">{e.id}</span><span className={`chip ${e.hardFact ? 'chip-fact' : 'chip-signal'}`}>{e.hardFact ? 'fact' : 'signal'}</span></p>
                    <p className="mt-1">{e.statement}</p>
                  </li>
                ))}
              </ul>
            </Block>
            <Block title="Network reading">
              <NetworkReading caseId={model.caseId} canGenerate={ctx.canGenerate ?? false} />
            </Block>
            <Block title="Recommended action">
              <p>{pack?.confidence?.route.text ?? 'A human reviewer decides the next step.'}</p>
              <p className="text-muted-foreground">Proposed: {(detail?.defaultAction ?? pack?.defaultAction ?? '').replace(/_/g, ' ').toLowerCase()}</p>
            </Block>
          </>
        )}

        {/* ----------------------------------------------------------------------------------------- provider */}
        {node?.type === 'provider' && (
          <>
            <Block title="Identity" open>
              <dl className="space-y-1.5">
                <KV k="Role in case" v={node.caption} />
                {node.stats.map((s) => <KV key={s.label} k={s.label} v={s.value} />)}
                <KV k="Links in view" v={[...(model.adjacency.get(node.id) ?? [])].filter((x) => !ctx.visible || ctx.visible.has(x)).length} />
              </dl>
            </Block>
            {node.risk && (
              <Block title="Risk" open>
                <dl className="space-y-1.5">
                  <KV k="Level" v={<span style={{ color: RISK_COLOR[node.risk.level] }}>{node.risk.level}</span>} />
                  <KV k="Risk score" v={(simRisk ?? node.risk.score).toFixed(2)} />
                  <KV k="Confidence" v={pack?.confidence?.level ?? model.risk?.confidence ?? '-'} />
                  <KV k="Severity" v={pack?.confidence?.risk.severity.toFixed(2) ?? '-'} />
                </dl>
                <ul className="space-y-1.5 pt-1">
                  {(pack?.confidence?.risk.drivers ?? []).map((d) => (
                    <li key={d.channel}>
                      <div className="flex justify-between text-xs"><span className="text-muted-foreground">{d.channel.toLowerCase()}</span><span className="mono">{d.contribution.toFixed(2)}</span></div>
                      <div className="h-1 rounded bg-muted"><div className="h-1 rounded bg-[var(--signal)] transition-all duration-700" style={{ width: `${Math.min(100, d.contribution * 100)}%` }} /></div>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">Risk is how much attention a case deserves. It is not confidence.</p>
              </Block>
            )}
            {node.risk && (
              <Block title="Evidence" count={evidence.length} open>
                <ul className="space-y-2">
                  {evidence.map((e) => (
                    <li key={e.id} className="rounded-lg border p-2.5">
                      <p className="flex items-center gap-2"><span className="mono text-[0.68rem] text-muted-foreground">{e.id}</span><span className={`chip ${e.hardFact ? 'chip-fact' : 'chip-signal'}`}>{e.hardFact ? 'fact' : 'signal'}</span></p>
                      <p className="mt-1">{e.statement}</p>
                    </li>
                  ))}
                </ul>
              </Block>
            )}
            <Block title="Network" count={model.adjacency.get(node.id)?.size ?? 0}>
              <div className="flex flex-wrap gap-1.5">
                {neighborsOf(node.id).filter((n) => n.type !== 'claim' && n.type !== 'member').map((n) => <Chip key={n.id} onClick={() => onSelect({ kind: 'node', id: n.id })}>{n.id}</Chip>)}
              </div>
              {node.id !== primary && primary && (() => { const p = shortestPath(model, primary, node.id); return p ? <p className="text-muted-foreground">Path from {primary}: {p.join(' → ')}</p> : null })()}
              <button type="button" className="text-xs underline underline-offset-2" onClick={() => onFocus([...(model.adjacency.get(node.id) ?? []), node.id])}>Focus this neighbourhood</button>
            </Block>
            <Block title="Claims" count={`${claimsOf(node.id).length} shown${model.claimTotal ? ` of ${model.claimTotal} lines` : ''}`}>
              {claimsOf(node.id).length === 0 && <p className="text-muted-foreground">Claim nodes are hidden. Turn on the Claims layer or ask “Show suspicious claims”.</p>}
              <ul className="space-y-1">
                {claimsOf(node.id).slice(0, 8).map((c) => (
                  <li key={c.id}><button type="button" className="flex w-full justify-between gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted" onClick={() => onSelect({ kind: 'node', id: c.id })}><span className="mono text-xs">{c.id}</span><span className="text-muted-foreground">{c.stats.find((s) => s.label === 'Paid')?.value}</span></button></li>
                ))}
              </ul>
            </Block>
            <Block title="Members" count={neighborsOf(node.id, 'member').length}>
              <div className="flex flex-wrap gap-1.5">{neighborsOf(node.id, 'member').slice(0, 14).map((m) => <Chip key={m.id} onClick={() => onSelect({ kind: 'node', id: m.id })}>{m.id}</Chip>)}</div>
            </Block>
            <Block title="Facilities"><p className="text-muted-foreground">This case's data has no shared-facility records for this provider.</p></Block>
            <Block title="History" count={events(node.id).length}>
              <ul className="space-y-1">{events(node.id).map((e) => <li key={e.date + e.label}><span className="mono text-xs text-muted-foreground">{e.date}</span> {e.label}</li>)}</ul>
              {events(node.id).length === 0 && <p className="text-muted-foreground">No dated events for this provider.</p>}
            </Block>
            {node.risk && (
              <Block title="Investigation status">
                <dl className="space-y-1.5"><KV k="Case" v={model.caseId} mono /><KV k="Status" v={detail?.status?.replace(/_/g, ' ').toLowerCase() ?? '-'} /><KV k="Assigned" v={detail?.assignedTo ?? 'unassigned'} /></dl>
                <p>{pack?.confidence?.route.text}</p>
              </Block>
            )}
          </>
        )}

        {/* ----------------------------------------------------------------------------------------- owner */}
        {node?.type === 'owner' && (
          <>
            <Block title="Controls" open count={neighborsOf(node.id, 'provider').length}>
              <ul className="space-y-1">
                {neighborsOf(node.id, 'provider').map((p) => {
                  const e = model.edges.find((x) => (x.source === p.id && x.target === node.id) || (x.target === p.id && x.source === node.id))
                  return <li key={p.id} className="flex justify-between"><button type="button" className="mono text-xs underline underline-offset-2" onClick={() => onSelect({ kind: 'node', id: p.id })}>{p.id}</button><span className="text-muted-foreground">{e?.label}</span></li>
                })}
              </ul>
            </Block>
            <Block title="Why it matters" open>
              <p>Shared ownership is a derived link. It matters here because the owned providers also appear together in this case. It does not by itself show coordination.</p>
            </Block>
          </>
        )}

        {/* ----------------------------------------------------------------------------------------- member */}
        {node?.type === 'member' && (
          <>
            <Block title="Flagged claims" open count={neighborsOf(node.id, 'claim').length || node.stats.find((s) => s.label === 'Flagged claims')?.value}>
              <dl className="space-y-1.5">{node.stats.map((s) => <KV key={s.label} k={s.label} v={s.value} />)}</dl>
              <ul className="space-y-1">{neighborsOf(node.id, 'claim').map((c) => <li key={c.id}><button type="button" className="mono text-xs underline underline-offset-2" onClick={() => onSelect({ kind: 'node', id: c.id })}>{c.id}</button></li>)}</ul>
            </Block>
            <Block title="Billed by"><div className="flex flex-wrap gap-1.5">{neighborsOf(node.id, 'provider').map((p) => <Chip key={p.id} onClick={() => onSelect({ kind: 'node', id: p.id })}>{p.id}</Chip>)}</div></Block>
            <Block title="Privacy"><p className="text-muted-foreground">Members are shown by identifier only. Use case and claim ids when you ask for help.</p></Block>
          </>
        )}

        {/* ----------------------------------------------------------------------------------------- claim */}
        {node?.type === 'claim' && (
          <>
            <Block title="Claim details" open>
              <dl className="space-y-1.5">
                {node.stats.map((s) => <KV key={s.label} k={s.label} v={s.value} />)}
                {node.lines?.[0] && <KV k="Service" v={node.lines[0].label} />}
                <KV k="Provider" v={neighborsOf(node.id, 'provider').map((p) => p.id).join(', ') || '-'} mono />
                <KV k="Member" v={neighborsOf(node.id, 'member').map((p) => p.id).join(', ') || '-'} mono />
              </dl>
            </Block>
            <Block title="Detection signals" open>
              <ul className="space-y-2">{(node.evidenceIds ?? []).map((id) => { const e = evidence.find((x) => x.id === id); return e ? <li key={id} className="rounded-lg border p-2.5"><span className="mono text-[0.68rem] text-muted-foreground">{id}</span> <span className={`chip ${e.hardFact ? 'chip-fact' : 'chip-signal'}`}>{e.hardFact ? 'fact' : 'signal'}</span><p className="mt-1">{e.statement}</p></li> : null })}</ul>
            </Block>
            <Block title="Confidence"><p>{pack?.confidence?.statement ?? 'Confidence is shown on the case.'}</p></Block>
            <Block title="Investigation status"><p>Case {model.caseId}: {detail?.status?.replace(/_/g, ' ').toLowerCase() ?? '-'}.</p></Block>
          </>
        )}

        {/* ----------------------------------------------------------------------------------------- relationship */}
        {edge && (
          <>
            <Block title="Link" open>
              <dl className="space-y-1.5">
                <KV k="Source" v={<button type="button" className="mono text-xs underline underline-offset-2" onClick={() => onSelect({ kind: 'node', id: edge.source })}>{edge.source}</button>} />
                <KV k="Target" v={<button type="button" className="mono text-xs underline underline-offset-2" onClick={() => onSelect({ kind: 'node', id: edge.target })}>{edge.target}</button>} />
                <KV k="Type" v={KIND_LABEL[edge.kind]} />
                <KV k="Frequency" v={edge.nClaims ? `${edge.nClaims} flagged claim${edge.nClaims === 1 ? '' : 's'}` : edge.label} />
                <KV k="Basis" v={edge.derived ? 'derived from records' : 'from a flagged claim line'} />
              </dl>
              {edge.derived && <p className="text-xs text-muted-foreground">A derived link shows association, not confirmed coordination.</p>}
            </Block>
            <Block title="Evidence" open>
              {(() => {
                const rel = evidence.filter((e) => e.channel === 'NETWORK' || e.channel === 'LINE').slice(0, 3)
                return rel.length ? <ul className="space-y-1.5">{rel.map((e) => <li key={e.id}><span className="mono text-[0.68rem] text-muted-foreground">{e.id}</span> {e.statement}</li>)}</ul> : <p className="text-muted-foreground">No evidence item names this link directly.</p>
              })()}
            </Block>
            <Block title="Risk and confidence">
              <dl className="space-y-1.5"><KV k="Case risk" v={model.risk ? `${model.risk.level} · ${model.risk.score.toFixed(2)}` : '-'} /><KV k="Confidence" v={pack?.confidence?.level ?? '-'} /></dl>
            </Block>
            <Block title="Historical context">
              <ul className="space-y-1">{[...events(edge.source), ...events(edge.target)].map((e) => <li key={e.date + e.label}><span className="mono text-xs text-muted-foreground">{e.date}</span> {e.label}</li>)}</ul>
              {events(edge.source).length + events(edge.target).length === 0 && <p className="text-muted-foreground">No dated events for these entities.</p>}
            </Block>
            <Block title="Recommended review"><p>Check the source records behind this link before relying on it. {pack?.confidence?.evidence.missing[0] ?? ''}</p></Block>
          </>
        )}
      </div>
      <p className="border-t px-4 py-2 text-[0.68rem] text-muted-foreground">Synthetic data. Indicators need human review; they are not findings.</p>
    </div>
  )
}
