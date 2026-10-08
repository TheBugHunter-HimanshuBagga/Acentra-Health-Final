// The investigation playback. The steps are built from the case's own records, in the order an investigator would
// follow them: the provider, who owns it, the flagged claims, the members they touch, each piece of evidence, the
// relationships, how the risk adds up, and the recommended human review. Nothing is scripted: a case without owners
// has no ownership step, a case without claim lines scans billing links instead, and the risk values are the engine's.
import type { EvidenceItem, EvidencePack } from '@/lib/types'
import type { GNode, Model } from './model'

export type StepKind = 'DISCOVERY' | 'CLAIM_ANALYSIS' | 'SUSPICIOUS' | 'RELATIONSHIP' | 'RISK' | 'SIU'

export interface Step {
  id: string
  kind: StepKind
  title: string
  body: string
  evidenceId?: string
  channel?: string
  reveal: { nodes: string[]; edges: string[] }
  activate: string[]
  hot: string[]
  /** a signal travels along the edge, away from `from` */
  signals: { edgeId: string; from: string }[]
  focus: string[]
  /** risk after this step (0..1); the last step equals the engine's score */
  risk: number
  /** the entity the inspector should show */
  select?: string
}

export const KIND_LABEL: Record<StepKind, string> = {
  DISCOVERY: 'Discovery', CLAIM_ANALYSIS: 'Claim analysis', SUSPICIOUS: 'Suspicious signal',
  RELATIONSHIP: 'Relationship discovered', RISK: 'Risk escalation', SIU: 'SIU recommendation',
}

const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`

export function buildSteps(model: Model, pack: EvidencePack | undefined, action: string | undefined): Step[] {
  const steps: Step[] = []
  const primary = model.primary[0] ?? [...model.nodes.values()].find((n) => n.type === 'provider')?.id
  if (!primary) return steps
  const finalRisk = model.risk?.score ?? 0
  const drivers = [...(pack?.confidence?.risk.drivers ?? [])].sort((a, b) => b.contribution - a.contribution)
  const total = drivers.reduce((s, d) => s + d.contribution, 0)
  const applied = new Set<string>()
  let cum = 0
  const riskNow = () => (total > 0 ? Math.min(finalRisk, (cum / total) * finalRisk) : 0)
  const apply = (channel?: string): string | undefined => {
    const d = drivers.find((x) => x.channel === channel && !applied.has(x.channel))
    if (!d) return undefined
    applied.add(d.channel)
    cum += d.contribution
    return d.channel
  }
  const sorted = (ids: string[], by: (n: GNode) => number) => ids.map((i) => model.nodes.get(i)!).filter(Boolean).sort((a, b) => by(b) - by(a))
  const edgeIds = (a: string, b: string, kinds?: string[]) =>
    model.edges.filter((e) => ((e.source === a && e.target === b) || (e.source === b && e.target === a)) && (!kinds || kinds.includes(e.kind))).map((e) => e.id)
  const paid = (n: GNode) => (n.lines ?? []).reduce((s, l) => s + l.paid, 0)
  const push = (s: Omit<Step, 'id' | 'risk'> & { risk?: number }) => steps.push({ ...s, id: `S${steps.length + 1}`, risk: s.risk ?? riskNow() })

  push({ kind: 'DISCOVERY', title: `Open provider ${primary}`, body: `The investigation starts at ${primary}, the case's primary provider${model.risk ? `, classified ${model.risk.level} risk` : ''}.`, reveal: { nodes: model.primary.length ? model.primary : [primary], edges: [] }, activate: [primary], hot: [], signals: [], focus: [primary], select: primary, risk: 0 })

  const owners = [...(model.adjacency.get(primary) ?? [])].filter((id) => model.nodes.get(id)?.type === 'owner')
  if (owners.length) {
    const eids = owners.flatMap((o) => edgeIds(primary, o, ['owner']))
    push({ kind: 'RELATIONSHIP', title: 'Check ownership', body: `${primary} is linked to ${owners.length === 1 ? 'an ownership group' : `${owners.length} ownership groups`} (${owners.join(', ')}). Shared ownership is a derived link, not a confirmed one.`, reveal: { nodes: owners, edges: eids }, activate: owners, hot: [], signals: eids.map((e) => ({ edgeId: e, from: primary })), focus: [primary, ...owners] })
  }

  const claimIds = sorted([...(model.adjacency.get(primary) ?? [])].filter((id) => model.nodes.get(id)?.type === 'claim'), paid).slice(0, 10).map((n) => n.id)
  let memberIds: string[] = []
  if (claimIds.length) {
    const eids = claimIds.flatMap((c) => edgeIds(primary, c, ['claim']))
    const sum = claimIds.reduce((s, c) => s + paid(model.nodes.get(c)!), 0)
    push({ kind: 'CLAIM_ANALYSIS', title: 'Scan the flagged claims', body: `${claimIds.length} of the highest-paid flagged claims are brought in (${money(sum)} paid). Each is a claim line the detectors flagged on exact fields.`, reveal: { nodes: claimIds, edges: eids }, activate: claimIds, hot: [], signals: eids.map((e) => ({ edgeId: e, from: primary })), focus: [primary, ...claimIds] })
    memberIds = [...new Set(claimIds.flatMap((c) => [...(model.adjacency.get(c) ?? [])].filter((m) => model.nodes.get(m)?.type === 'member')))]
    const seids = claimIds.flatMap((c) => memberIds.flatMap((m) => edgeIds(c, m, ['serves'])))
    push({ kind: 'DISCOVERY', title: 'Trace to the affected members', body: `Those claims touch ${memberIds.length} member${memberIds.length === 1 ? '' : 's'}. Members are shown by identifier only.`, reveal: { nodes: memberIds, edges: seids }, activate: memberIds, hot: [], signals: seids.map((e) => ({ edgeId: e, from: model.edges.find((x) => x.id === e)!.source })), focus: [primary, ...claimIds, ...memberIds] })
  } else {
    const billed = model.edges.filter((e) => e.kind === 'billed' && (e.source === primary || e.target === primary)).sort((a, b) => b.nClaims - a.nClaims).slice(0, 10)
    if (billed.length) {
      memberIds = billed.map((e) => (e.source === primary ? e.target : e.source))
      push({ kind: 'CLAIM_ANALYSIS', title: 'Scan the billing links', body: `${primary} billed ${billed.reduce((s, e) => s + e.nClaims, 0)} flagged claims for ${billed.length} members.`, reveal: { nodes: memberIds, edges: billed.map((e) => e.id) }, activate: memberIds, hot: [], signals: billed.map((e) => ({ edgeId: e.id, from: primary })), focus: [primary, ...memberIds] })
    }
  }

  const ev: EvidenceItem[] = [...(pack?.evidence ?? [])].sort((a, b) => Number(b.hardFact) - Number(a.hardFact) || b.dollars - a.dollars).slice(0, 4)
  ev.forEach((e, i) => {
    const hot = claimIds.filter((c) => model.nodes.get(c)?.evidenceIds?.includes(e.id))
    const channel = apply(e.channel)
    push({
      kind: e.channel === 'NETWORK' ? 'RELATIONSHIP' : i === 0 && e.channel === 'LINE' ? 'CLAIM_ANALYSIS' : 'SUSPICIOUS',
      title: e.name, body: `${e.statement}.${e.dollars > 0 ? ` ${money(e.dollars)} ${e.dollarsBasis === 'ESTIMATED' ? 'estimated' : 'exact'} exposure.` : ''}`,
      evidenceId: e.id, channel: e.channel, reveal: { nodes: [], edges: [] }, activate: hot.length ? hot : [primary], hot: hot.length ? hot : [primary], signals: [],
      focus: hot.length ? [primary, ...hot] : [primary], select: hot[0] ?? primary,
      risk: channel ? riskNow() : undefined,
    })
  })

  const shown = new Set(steps.flatMap((s) => s.reveal.nodes))
  const rest = [...model.nodes.values()].filter((n) => !shown.has(n.id) && n.type !== 'claim')
  const restProv = rest.filter((n) => n.type === 'provider' || n.type === 'owner' || n.type === 'facility')
  if (restProv.length) {
    const ids = new Set(restProv.map((n) => n.id))
    const eids = model.edges.filter((e) => (ids.has(e.source) || ids.has(e.target)) && e.kind !== 'serves' && e.kind !== 'claim').map((e) => e.id)
    push({ kind: 'RELATIONSHIP', title: 'Related providers discovered', body: `${restProv.length} connected provider${restProv.length === 1 ? '' : 's'} appear through ownership or referrals: ${restProv.slice(0, 6).map((n) => n.id).join(', ')}. These links are derived and need verifying.`, reveal: { nodes: [...ids], edges: eids }, activate: [...ids], hot: [], signals: eids.slice(0, 12).map((e) => ({ edgeId: e, from: primary })), focus: [primary, ...ids] })
  }

  for (const d of drivers) {
    if (applied.has(d.channel)) continue
    apply(d.channel)
    push({ kind: 'RISK', title: `${{ LINE: 'Claim-line', PEER: 'Peer', SELF: 'Own-history', NETWORK: 'Relationship' }[d.channel] ?? d.channel} signal adds to the risk`, body: `${d.text}. The risk reaches ${riskNow().toFixed(2)}.`, channel: d.channel, reveal: { nodes: [], edges: [] }, activate: [primary], hot: [primary], signals: [], focus: [primary], select: primary })
  }

  const left = [...model.nodes.keys()].filter((id) => !steps.some((s) => s.reveal.nodes.includes(id)) && model.nodes.get(id)?.type !== 'claim')
  push({
    kind: 'SIU', title: 'SIU review recommended',
    body: `${pack?.confidence?.route.text ?? 'A human reviewer should look at this case.'} Proposed action: ${(action ?? pack?.defaultAction ?? 'REQUEST_RECORDS').replace(/_/g, ' ').toLowerCase()}. A person makes the final decision.`,
    reveal: { nodes: left, edges: model.edges.filter((e) => left.includes(e.source) || left.includes(e.target)).filter((e) => e.kind !== 'serves' && e.kind !== 'claim').map((e) => e.id) },
    activate: [primary], hot: [primary], signals: [], focus: [...model.nodes.keys()].filter((id) => model.nodes.get(id)?.type !== 'claim'), select: primary, risk: finalRisk,
  })
  return steps
}

export interface SimState {
  nodes: Set<string>
  edges: Set<string>
  active: Set<string>
  hot: Set<string>
  risk: number
  index: number
}

export function stateAt(steps: Step[], index: number): SimState {
  const nodes = new Set<string>(), edges = new Set<string>(), hot = new Set<string>()
  for (let i = 0; i <= index && i < steps.length; i++) {
    steps[i].reveal.nodes.forEach((n) => nodes.add(n))
    steps[i].reveal.edges.forEach((e) => edges.add(e))
    if (i === index) steps[i].hot.forEach((n) => hot.add(n))
  }
  const s = steps[Math.min(index, steps.length - 1)]
  return { nodes, edges, active: new Set(s?.activate ?? []), hot, risk: s?.risk ?? 0, index }
}
