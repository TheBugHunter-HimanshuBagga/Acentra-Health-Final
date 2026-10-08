// The investigation graph model: entities and relationships assembled from the case's real data (the stored graph, the
// flagged claim lines and the evidence pack). Nothing here is invented: a relationship exists only if a record shows
// it, and a risk is shown only where the engine computed one. Layout is a one-time, deterministic relaxation; after
// that, positions only change when the investigator moves a node or asks for a reset.
import type { CaseDetail, ClaimLine, EvidencePack } from '@/lib/types'
import type { CaseGraph } from '@/lib/types2'

export type EntityType = 'provider' | 'owner' | 'member' | 'claim' | 'facility'
export type EdgeKind = 'owner' | 'billed' | 'referral' | 'claim' | 'serves' | 'facility'
export type Level = 'HIGH' | 'MEDIUM' | 'LOW' | 'MONITOR'

export interface GNode {
  id: string
  type: EntityType
  label: string
  caption: string
  role?: string
  /** risk is present only where the engine scored it (the case's primary subjects) */
  risk?: { level: Level; score: number }
  stats: { label: string; value: string }[]
  w: number
  h: number
  x: number
  y: number
  pinned?: boolean
  /** claim nodes: the flagged lines behind them */
  lines?: ClaimLine[]
  evidenceIds?: string[]
}

export interface GEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
  label: string
  nClaims: number
  /** all links drawn from the stored graph are derived from claims, referral and ownership records */
  derived: boolean
}

export interface Model {
  caseId: string
  primary: string[]
  nodes: Map<string, GNode>
  edges: GEdge[]
  adjacency: Map<string, Set<string>>
  risk: { score: number; level: Level; confidence: string | null } | null
  claimTotal: number
  claimShown: number
}

export const SIZE: Record<EntityType, [number, number]> = {
  provider: [124, 84],
  owner: [112, 76],
  member: [92, 60],
  claim: [96, 58],
  facility: [112, 76],
}
export const TYPE_LABEL: Record<EntityType, string> = { provider: 'Provider', owner: 'Owner', member: 'Member', claim: 'Claim', facility: 'Facility' }
export const KIND_LABEL: Record<EdgeKind, string> = {
  owner: 'Owns', billed: 'Billed for', referral: 'Refers to', claim: 'Billed claim', serves: 'For member', facility: 'Shared facility',
}
const REST: Record<EdgeKind, number> = { owner: 270, billed: 230, referral: 300, claim: 190, serves: 150, facility: 260 }

const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`

export function buildModel(input: {
  caseId: string
  graph: CaseGraph
  claims: ClaimLine[]
  claimTotal: number
  pack: EvidencePack | undefined
  detail: CaseDetail | undefined
}): Model {
  const { caseId, graph, claims, pack, detail } = input
  const nodes = new Map<string, GNode>()
  const flagged = new Map<string, number>()
  for (const e of graph.edges) {
    if (e.type === 'billed') {
      flagged.set(e.source, (flagged.get(e.source) ?? 0) + (e.nClaims ?? 0))
      flagged.set(e.target, (flagged.get(e.target) ?? 0) + (e.nClaims ?? 0))
    }
  }
  const score = pack?.confidence?.risk.score
  const level = (detail?.tier ?? 'MONITOR') as Level
  const primary = graph.nodes.filter((n) => n.role === 'PRIMARY').map((n) => n.id)

  for (const n of graph.nodes) {
    const type = (['provider', 'owner', 'member', 'facility'].includes(n.type) ? n.type : 'provider') as EntityType
    const [w, h] = SIZE[type]
    const isPrimary = n.role === 'PRIMARY'
    const stats: GNode['stats'] = []
    if (type === 'provider') {
      if (n.specialty) stats.push({ label: 'Specialty', value: n.specialty.replace(/_/g, ' ').toLowerCase() })
      if (flagged.get(n.id)) stats.push({ label: 'Flagged claims', value: String(flagged.get(n.id)) })
    }
    if (type === 'member' && flagged.get(n.id)) stats.push({ label: 'Flagged claims', value: String(flagged.get(n.id)) })
    nodes.set(n.id, {
      id: n.id, type, label: n.label, role: n.role,
      caption: type === 'provider' ? (isPrimary ? 'Primary provider' : n.role === 'REFERRER' ? 'Referral source' : n.role === 'NETWORK' ? 'Network provider' : 'Related provider') : TYPE_LABEL[type],
      risk: isPrimary && score != null ? { level, score } : undefined,
      stats, w, h, x: n.x ?? 0, y: n.y ?? 0,
    })
  }

  const edges: GEdge[] = graph.edges.map((e) => ({
    id: e.id, source: e.source, target: e.target,
    kind: (['owner', 'billed', 'referral'].includes(e.type) ? e.type : 'billed') as EdgeKind,
    label: e.label, nClaims: e.nClaims ?? 0, derived: true,
  }))

  // claim nodes: the flagged lines grouped by claim, newest layer on top of the stored graph
  const byClaim = new Map<string, ClaimLine[]>()
  for (const l of claims) byClaim.set(l.claimId, [...(byClaim.get(l.claimId) ?? []), l])
  const MAX_CLAIMS = 40                       // the highest-paid claims; the rest stay in the case workspace
  const kept = [...byClaim.entries()].sort((a, b) => b[1].reduce((x, l) => x + l.paid, 0) - a[1].reduce((x, l) => x + l.paid, 0)).slice(0, MAX_CLAIMS)
  byClaim.clear()
  for (const [k, v] of kept) byClaim.set(k, v)
  for (const [cid, lines] of byClaim) {
    const paid = lines.reduce((s, l) => s + l.paid, 0)
    const first = lines[0]
    const [w, h] = SIZE.claim
    nodes.set(cid, {
      id: cid, type: 'claim', label: cid.replace(/^C-0*/, 'C-'), caption: 'Claim', lines,
      evidenceIds: [...new Set(lines.map((l) => l.evidenceId))],
      stats: [
        { label: 'Service date', value: first.serviceDt },
        { label: 'Code', value: first.hcpcs },
        { label: 'Paid', value: usd(paid) },
        { label: 'Lines', value: String(lines.length) },
        { label: 'Signal', value: first.flagRole.replace(/_/g, ' ').toLowerCase() },
      ],
      w, h, x: 0, y: 0,
    })
    if (nodes.has(first.providerId)) edges.push({ id: `claim:${first.providerId}>${cid}`, source: first.providerId, target: cid, kind: 'claim', label: usd(paid), nClaims: 1, derived: false })
    if (nodes.has(first.memberId)) edges.push({ id: `serves:${cid}>${first.memberId}`, source: cid, target: first.memberId, kind: 'serves', label: first.serviceDt, nClaims: 1, derived: false })
  }

  const adjacency = new Map<string, Set<string>>()
  for (const e of edges) {
    if (!nodes.has(e.source) || !nodes.has(e.target)) continue
    if (!adjacency.has(e.source)) adjacency.set(e.source, new Set())
    if (!adjacency.has(e.target)) adjacency.set(e.target, new Set())
    adjacency.get(e.source)!.add(e.target)
    adjacency.get(e.target)!.add(e.source)
  }
  const model: Model = {
    caseId, primary, nodes, edges: edges.filter((e) => nodes.has(e.source) && nodes.has(e.target)), adjacency,
    risk: score != null ? { score, level, confidence: pack?.confidence?.level ?? null } : null,
    claimTotal: input.claimTotal, claimShown: byClaim.size,
  }
  layout(model, new Set([...nodes.values()].filter((n) => n.type !== 'claim').map((n) => n.id)))
  placeClaims(model)
  return model
}

/** Claim tiles are placed around their provider with everything else held still, so turning the layer on never rearranges the network. */
export function placeClaims(model: Model): void {
  const claims = [...model.nodes.values()].filter((n) => n.type === 'claim' && n.x === 0 && n.y === 0)
  if (claims.length === 0) return
  const held = [...model.nodes.values()].filter((n) => n.type !== 'claim')
  const was = held.map((n) => n.pinned)
  held.forEach((n) => { n.pinned = true })
  layout(model, new Set(), 220)
  held.forEach((n, i) => { n.pinned = was[i] })
}

// ---------------------------------------------------------------------------------------------------- layout
/** Deterministic relaxation: link springs, repulsion, collision and a gentle type bias. Pinned nodes never move. */
export function layout(model: Model, visible: Set<string>, iterations = 260): void {
  const all = [...model.nodes.values()].filter((n) => visible.size === 0 || visible.has(n.id))
  if (all.length === 0) return
  // seed: new nodes (at 0,0 with no position) start near a neighbour, spread on a spiral
  let seeded = 0
  const ring = (i: number, r: number) => ({ x: Math.cos(i * 2.399) * r, y: Math.sin(i * 2.399) * r })
  const placed = all.filter((n) => n.x !== 0 || n.y !== 0)
  const cx = placed.length ? placed.reduce((s, n) => s + n.x, 0) / placed.length : 0
  const cy = placed.length ? placed.reduce((s, n) => s + n.y, 0) / placed.length : 0
  for (const n of all) {
    if (n.x !== 0 || n.y !== 0) continue
    const anchor = [...(model.adjacency.get(n.id) ?? [])].map((id) => model.nodes.get(id)!).find((m) => m && (m.x !== 0 || m.y !== 0))
    const base = anchor ?? { x: cx, y: cy }
    const p = ring(seeded++, 160 + seeded * 6)
    n.x = base.x + p.x
    n.y = base.y + p.y
  }
  // normalise the stored layout scale so the first view is roomy
  if (placed.length > 1 && placed.every((n) => !n.pinned)) {
    const minX = Math.min(...placed.map((n) => n.x)), maxX = Math.max(...placed.map((n) => n.x))
    const span = Math.max(1, maxX - minX)
    const k = Math.max(1, 760 / span)
    if (k > 1) for (const n of placed) { n.x = cx + (n.x - cx) * k; n.y = cy + (n.y - cy) * k }
  }
  const idx = new Map(all.map((n, i) => [n.id, i]))
  const vx = new Float64Array(all.length), vy = new Float64Array(all.length)
  const links = model.edges.filter((e) => idx.has(e.source) && idx.has(e.target))
  for (let it = 0; it < iterations; it++) {
    const alpha = 1 - it / iterations
    for (let i = 0; i < all.length; i++) {
      const a = all[i]
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j]
        let dx = b.x - a.x, dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) { dx = (i - j) * 0.7 + 0.1; dy = 0.3; d2 = dx * dx + dy * dy }
        const d = Math.sqrt(d2)
        const need = (a.w + b.w) / 2 + (a.h + b.h) / 2 + 26     // collision: keep tiles apart
        let f = 9000 / d2
        if (d < need) f += (need - d) * 0.9
        const fx = (dx / d) * f, fy = (dy / d) * f
        vx[i] -= fx; vy[i] -= fy; vx[j] += fx; vy[j] += fy
      }
    }
    for (const e of links) {
      const i = idx.get(e.source)!, j = idx.get(e.target)!
      const a = all[i], b = all[j]
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.max(1, Math.hypot(dx, dy))
      const f = (d - REST[e.kind]) * 0.02
      vx[i] += (dx / d) * f; vy[i] += (dy / d) * f
      vx[j] -= (dx / d) * f; vy[j] -= (dy / d) * f
    }
    for (let i = 0; i < all.length; i++) {
      const n = all[i]
      // owners drift upward, members and claims stay close to their provider; everything is gently centred
      if (n.type === 'owner') vy[i] -= 0.6
      vx[i] += (cx - n.x) * 0.0016; vy[i] += (cy - n.y) * 0.0016
      if (n.pinned) { vx[i] = 0; vy[i] = 0; continue }
      n.x += Math.max(-24, Math.min(24, vx[i])) * alpha
      n.y += Math.max(-24, Math.min(24, vy[i])) * alpha
      vx[i] *= 0.55; vy[i] *= 0.55
    }
  }
  for (const n of all) { n.x = Math.round(n.x * 10) / 10; n.y = Math.round(n.y * 10) / 10 }
}

// ------------------------------------------------------------------------------------------------- queries
export function neighborhood(model: Model, id: string, hops = 1): Set<string> {
  const seen = new Set([id])
  let frontier = [id]
  for (let h = 0; h < hops; h++) {
    const next: string[] = []
    for (const f of frontier) for (const n of model.adjacency.get(f) ?? []) if (!seen.has(n)) { seen.add(n); next.push(n) }
    frontier = next
  }
  return seen
}

/** Shortest path by number of links; null when the two are not connected. */
export function shortestPath(model: Model, from: string, to: string): string[] | null {
  if (!model.nodes.has(from) || !model.nodes.has(to)) return null
  const prev = new Map<string, string>()
  const q = [from]
  const seen = new Set([from])
  while (q.length) {
    const cur = q.shift()!
    if (cur === to) break
    for (const n of model.adjacency.get(cur) ?? []) if (!seen.has(n)) { seen.add(n); prev.set(n, cur); q.push(n) }
  }
  if (!seen.has(to)) return null
  const path = [to]
  while (path[0] !== from) path.unshift(prev.get(path[0])!)
  return path
}

export function edgeBetween(model: Model, a: string, b: string): GEdge | undefined {
  return model.edges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a))
}

export function edgesOf(model: Model, ids: Set<string>): Set<string> {
  const out = new Set<string>()
  for (const e of model.edges) if (ids.has(e.source) && ids.has(e.target)) out.add(e.id)
  return out
}

export function nodeBounds(nodes: GNode[], pad = 80): { x: number; y: number; w: number; h: number } {
  if (nodes.length === 0) return { x: -300, y: -200, w: 600, h: 400 }
  const x0 = Math.min(...nodes.map((n) => n.x - n.w / 2)) - pad
  const x1 = Math.max(...nodes.map((n) => n.x + n.w / 2)) + pad
  const y0 = Math.min(...nodes.map((n) => n.y - n.h / 2)) - pad
  const y1 = Math.max(...nodes.map((n) => n.y + n.h / 2)) + pad
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// -------------------------------------------------------------------------------------------- the copilot
export interface Selection { kind: 'none' | 'node' | 'edge'; id?: string }

export interface Reply {
  text: string
  /** graph changes to apply with the answer */
  focus?: Set<string>
  focusEdges?: Set<string>
  showClaims?: boolean
  path?: string[]
  citations: string[]
}

export interface Ctx {
  /** entities currently drawn; counts in the copilot's wording refer to these */
  visible?: Set<string>
  model: Model
  pack?: EvidencePack
  detail?: CaseDetail
  selection: Selection
}

const topEvidence = (pack?: EvidencePack, n = 3) => [...(pack?.evidence ?? [])].sort((a, b) => Number(b.hardFact) - Number(a.hardFact) || b.dollars - a.dollars).slice(0, n)

/** What the copilot says the moment something is selected. Built only from the evidence pack and the graph. */
export function briefFor(ctx: Ctx): { text: string; suggestions: string[]; citations: string[] } {
  const { model, pack, selection } = ctx
  const risk = model.risk
  if (selection.kind === 'node' && selection.id) {
    const n = model.nodes.get(selection.id)
    if (!n) return briefFor({ ...ctx, selection: { kind: 'none' } })
    const links = [...(model.adjacency.get(n.id) ?? [])].filter((x) => !ctx.visible || ctx.visible.has(x)).length
    if (n.type === 'provider') {
      const ev = topEvidence(pack, 3)
      if (n.risk) {
        const names = ev.map((e) => e.name.toLowerCase()).join(', ')
        return {
          text: `Provider ${n.id} is classified ${n.risk.level} risk (${n.risk.score.toFixed(2)} on the 0 to 1 risk scale${risk?.confidence ? `, ${risk.confidence} confidence` : ''}). The strongest signals are ${names || 'listed in the evidence pack'}. It connects to ${links} entities in this view. This is an indicator for human review, not a finding.`,
          suggestions: ['Why is this provider high risk?', 'Show suspicious claims', 'What is the strongest evidence?', 'Trace this network', 'What should I review next?'],
          citations: ev.map((e) => e.id),
        }
      }
      return {
        text: `Provider ${n.id} is a ${n.caption.toLowerCase()} in this case. The engine did not score it separately; it appears because of its links to ${[...(model.adjacency.get(n.id) ?? [])].slice(0, 4).join(', ')}. Its links are derived from claims, referral and ownership records, not confirmed relationships.`,
        suggestions: [`Everyone connected through ${n.id}`, `Trace the path from ${model.primary[0] ?? 'the primary provider'} to ${n.id}`, 'Explain this relationship'],
        citations: [],
      }
    }
    if (n.type === 'owner') return { text: `${n.id} is an ownership group linked to ${links} providers in this case. Shared ownership is a derived link, not a confirmed one; it matters when the owned providers also share referrals or billing patterns.`, suggestions: [`Everyone connected through ${n.id}`, 'Explain this relationship', 'What should I review next?'], citations: [] }
    if (n.type === 'member') return { text: `Member ${n.id} has ${n.stats.find((s) => s.label === 'Flagged claims')?.value ?? 'no'} flagged claims in this case. Member details are shown only as an identifier.`, suggestions: ['Show suspicious claims', `Trace the path from ${model.primary[0] ?? 'the provider'} to ${n.id}`], citations: [] }
    if (n.type === 'claim') return { text: `Claim ${n.id} is flagged on ${n.lines?.length ?? 0} line(s): ${n.stats.find((s) => s.label === 'Signal')?.value ?? 'signal'}, ${n.stats.find((s) => s.label === 'Paid')?.value ?? ''} paid, service date ${n.stats[0]?.value ?? ''}.`, suggestions: ['What is the strongest evidence?', 'Explain this relationship'], citations: n.evidenceIds ?? [] }
  }
  if (selection.kind === 'edge' && selection.id) {
    const e = model.edges.find((x) => x.id === selection.id)
    if (e) return { text: `${e.source} to ${e.target}: ${KIND_LABEL[e.kind].toLowerCase()}${e.nClaims ? `, ${e.nClaims} flagged claim${e.nClaims === 1 ? '' : 's'}` : ''} (${e.label}). ${e.derived ? 'Derived from records; not a confirmed relationship.' : 'Taken directly from a flagged claim line.'}`, suggestions: ['Explain this relationship', 'What should I review next?'], citations: [] }
  }
  const ev = topEvidence(pack, 2)
  return {
    text: risk
      ? `This case is ${risk.level} risk (${risk.score.toFixed(2)})${risk.confidence ? ` with ${risk.confidence} confidence` : ''}. Select a provider, member, claim or link to see what the evidence says about it, or press Simulate investigation to watch the evidence build up.`
      : 'Select an entity or a link to see what the evidence says about it.',
    suggestions: ['Why was this case flagged?', 'Show suspicious claims', 'What is the strongest evidence?', 'What should I review next?'],
    citations: ev.map((e) => e.id),
  }
}

const clean = (s: string) => s.toLowerCase().replace(/[?.!]/g, '').trim()

/** A reliable subset of natural-language graph control. Returns null for anything else (the server copilot answers it). */
export function answerLocally(question: string, ctx: Ctx): Reply | null {
  const { model, pack } = ctx
  const q = clean(question)
  const ids = (question.match(/\b(?:P|M|C|OWN|F)-[A-Za-z0-9-]+/g) ?? []).filter((x) => model.nodes.has(x))
  const selected = ctx.selection.kind === 'node' ? ctx.selection.id : undefined

  const path = /\b(trace|path|route)\b/.exec(q) && ids.length >= 2 ? shortestPath(model, ids[0], ids[1]) : undefined
  if (/\b(trace|path|route)\b/.test(q) && ids.length >= 2) {
    if (!path) return { text: `${ids[0]} and ${ids[1]} are not connected in the records shown here.`, citations: [] }
    const edgeIds = new Set<string>()
    for (let i = 0; i < path.length - 1; i++) { const e = edgeBetween(model, path[i], path[i + 1]); if (e) edgeIds.add(e.id) }
    return { text: `The shortest path from ${ids[0]} to ${ids[1]} has ${path.length - 1} link${path.length === 2 ? '' : 's'}: ${path.join(' → ')}. These links are derived from records.`, focus: new Set(path), focusEdges: edgeIds, path, citations: [] }
  }
  if (/(everyone|everything|who).*(connected|linked)|connected (through|to)|neighbo/.test(q) && (ids[0] || selected)) {
    const id = ids[0] ?? selected!
    const hood = neighborhood(model, id, 1)
    return { text: `${hood.size - 1} entit${hood.size === 2 ? 'y is' : 'ies are'} directly connected to ${id}: ${[...hood].filter((x) => x !== id).slice(0, 8).join(', ')}${hood.size > 9 ? ' and more' : ''}.`, focus: hood, focusEdges: edgesOf(model, hood), citations: [] }
  }
  if (/(suspicious|flagged|contribut).*(claim|line)|claim.*(suspicious|flagged|contribut)|show.*claims/.test(q)) {
    const scope = selected && model.nodes.get(selected)?.type === 'provider' ? selected : undefined
    const claimNodes = [...model.nodes.values()].filter((n) => n.type === 'claim' && (!scope || (model.adjacency.get(n.id)?.has(scope) ?? false)))
    const lines = claimNodes.flatMap((c) => c.lines ?? [])
    if (claimNodes.length === 0) return { text: 'No flagged claim lines are loaded for this case.', citations: [] }
    const paid = lines.reduce((s, l) => s + l.paid, 0)
    const members = new Set(lines.map((l) => l.memberId))
    const focus = new Set<string>(claimNodes.map((c) => c.id))
    for (const c of claimNodes) for (const n of model.adjacency.get(c.id) ?? []) focus.add(n)
    const more = model.claimTotal > lines.length ? ` Showing the ${lines.length} highest-paid of ${model.claimTotal} flagged lines.` : ''
    return { text: `I found ${claimNodes.length} claims (${lines.length} lines, $${Math.round(paid).toLocaleString('en-US')} paid) across ${members.size} members contributing to the risk signal.${more}`, focus, focusEdges: edgesOf(model, focus), showClaims: true, citations: [...new Set(lines.map((l) => l.evidenceId))] }
  }
  if (/strongest.*evidence|best evidence|main evidence/.test(q)) {
    const e = topEvidence(pack, 1)[0]
    if (!e) return { text: 'The evidence pack lists no evidence for this case.', citations: [] }
    return { text: `${e.statement}. ${e.hardFact ? 'This is a recorded fact on exact fields.' : 'This is a statistical or relationship signal, not a recorded fact.'}`, citations: [e.id] }
  }
  if (/why.*(risk|flag|high|suspicious)|explain.*(risk|case)|why was this/.test(q)) {
    const r = model.risk
    const ev = topEvidence(pack, 3)
    if (!r || ev.length === 0) return null
    return { text: `${model.primary[0] ?? 'The primary provider'} is ${r.level} risk (${r.score.toFixed(2)}) because: ${ev.map((e) => e.statement).join('; ')}.`, citations: ev.map((e) => e.id) }
  }
  if (/review next|what should i (do|review)|next step|recommend/.test(q)) {
    const miss = pack?.confidence?.evidence.missing ?? []
    return { text: `The proposed human action is ${(ctx.detail?.defaultAction ?? pack?.defaultAction ?? 'REQUEST_RECORDS').replace(/_/g, ' ').toLowerCase()}. ${miss.length ? `Missing evidence that would raise confidence: ${miss.slice(0, 3).join('; ')}.` : 'The pack lists no missing evidence.'} A person makes the final decision.`, citations: [] }
  }
  if (/explain.*relationship|this (link|relationship)/.test(q) && ctx.selection.kind === 'edge') {
    const e = model.edges.find((x) => x.id === ctx.selection.id)
    if (!e) return null
    return { text: `${e.source} → ${e.target} is a "${KIND_LABEL[e.kind].toLowerCase()}" link${e.nClaims ? ` carrying ${e.nClaims} flagged claims` : ''}. ${e.derived ? 'It is derived from claim, referral or ownership records, so it shows association, not proof of coordination.' : 'It comes directly from a flagged claim line.'}`, focus: new Set([e.source, e.target]), focusEdges: new Set([e.id]), citations: [] }
  }
  return null
}
