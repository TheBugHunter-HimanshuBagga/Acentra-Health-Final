import { describe, expect, it } from 'vitest'
import { detail, graph, lines, pack } from './fixtures'
import { answerLocally, briefFor, buildModel, layout, neighborhood, shortestPath, type Selection } from './model'
import { buildSteps, stateAt } from './simulation'

const make = () => buildModel({ caseId: 'CASE-0014', graph, claims: lines, claimTotal: 66, pack, detail })

describe('the graph model', () => {
  it('builds typed entities and only the relationships the records show', () => {
    const m = make()
    expect(m.primary).toEqual(['P-0044'])
    expect(m.nodes.get('P-0044')?.risk).toEqual({ level: 'HIGH', score: 0.94 })
    expect(m.nodes.get('P-0207')?.risk).toBeUndefined()           // the engine scored only the primary subject
    expect(m.nodes.get('C-0000000001')?.type).toBe('claim')
    expect(m.nodes.get('C-0000000001')?.stats.find((s) => s.label === 'Paid')?.value).toBe('$120')
    expect(m.edges.every((e) => m.nodes.has(e.source) && m.nodes.has(e.target))).toBe(true)
    expect(m.claimShown).toBe(3)
  })

  it('lays tiles out without overlap, and never moves a tile the investigator placed', () => {
    const m = make()
    const all = [...m.nodes.values()]
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j]
        const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 2
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false)
      }
    }
    const n = m.nodes.get('M-2')!
    n.x = 1234
    n.y = -321
    n.pinned = true
    layout(m, new Set(), 80)
    expect([n.x, n.y]).toEqual([1234, -321])
  })

  it('finds neighbourhoods and shortest paths, and says when there is none', () => {
    const m = make()
    expect([...neighborhood(m, 'OWN-0044')].sort()).toEqual(['OWN-0044', 'P-0044', 'P-0207'])
    expect(shortestPath(m, 'P-0044', 'P-0207')).toEqual(['P-0044', 'OWN-0044', 'P-0207'])
    expect(shortestPath(m, 'P-0044', 'M-3')).toEqual(['P-0044', 'OWN-0044', 'P-0207', 'M-3'])
    expect(shortestPath(m, 'P-0044', 'NOPE')).toBeNull()
  })
})

describe('the copilot', () => {
  const ctx = (selection: Selection = { kind: 'none' }) => ({ model: make(), pack, detail, selection })

  it('reads a selected provider from the evidence pack', () => {
    const b = briefFor(ctx({ kind: 'node', id: 'P-0044' }))
    expect(b.text).toContain('HIGH risk (0.94')
    expect(b.text).toContain('service dated after recorded death')
    expect(b.text).toContain('not a finding')
    expect(b.suggestions).toContain('Show suspicious claims')
    expect(b.citations).toEqual(['E1', 'E2'])
  })

  it('changes its suggestions with the selection and never scores an unscored provider', () => {
    const b = briefFor(ctx({ kind: 'node', id: 'P-0207' }))
    expect(b.text).not.toMatch(/risk \(/)
    expect(b.text).toContain('not confirmed relationships')
    expect(b.suggestions.some((s) => s.includes('P-0207'))).toBe(true)
  })

  it('answers graph questions and returns the graph change that goes with them', () => {
    const claimsReply = answerLocally('Show me the suspicious claims', ctx())!
    expect(claimsReply.showClaims).toBe(true)
    expect(claimsReply.focus?.has('C-0000000001')).toBe(true)
    expect(claimsReply.text).toContain('3 claims')
    expect(claimsReply.text).toContain('$260')
    const through = answerLocally('Show me everyone connected through OWN-0044', ctx())!
    expect([...through.focus!].sort()).toEqual(['OWN-0044', 'P-0044', 'P-0207'])
    const trace = answerLocally('Trace the path from P-0044 to M-3', ctx())!
    expect(trace.path).toEqual(['P-0044', 'OWN-0044', 'P-0207', 'M-3'])
  })

  it('hands anything it cannot answer from the records to the server copilot', () => {
    expect(answerLocally('What is the weather in Delhi?', ctx())).toBeNull()
    expect(answerLocally('What is the strongest evidence?', ctx())!.citations).toEqual(['E1'])
  })
})

describe('the investigation playback', () => {
  const m = make()
  const steps = buildSteps(m, pack, 'REQUEST_RECORDS')

  it('is read from the case: ownership, claims, members, evidence, relationships, risk, and a human review', () => {
    expect(steps[0].title).toContain('P-0044')
    expect(steps.some((s) => s.title === 'Check ownership')).toBe(true)
    expect(steps.some((s) => s.title === 'Scan the flagged claims')).toBe(true)
    expect(steps.some((s) => s.evidenceId === 'E1' && s.kind !== 'RISK')).toBe(true)
    expect(steps.at(-1)!.kind).toBe('SIU')
    expect(steps.at(-1)!.body).toContain('A person makes the final decision')
  })

  it('moves risk upward only, and ends on exactly the engine score', () => {
    const risks = steps.map((s) => s.risk)
    for (let i = 1; i < risks.length; i++) expect(risks[i]).toBeGreaterThanOrEqual(risks[i - 1])
    expect(risks[0]).toBe(0)
    expect(risks.at(-1)).toBe(0.94)
  })

  it('reveals only entities that exist and accumulates them step by step', () => {
    for (const s of steps) for (const id of s.reveal.nodes) expect(m.nodes.has(id)).toBe(true)
    const early = stateAt(steps, 0), late = stateAt(steps, steps.length - 1)
    expect([...early.nodes]).toEqual(['P-0044'])
    expect(late.nodes.size).toBeGreaterThan(early.nodes.size)
    for (const s of steps) for (const sig of s.signals) expect(m.edges.some((e) => e.id === sig.edgeId)).toBe(true)
  })

  it('has no ownership step for a case without owners, and falls back to billing links without claim lines', () => {
    const bare = buildModel({ caseId: 'C', graph: { nodes: [graph.nodes[0], graph.nodes[3]], edges: [graph.edges[2]] }, claims: [], claimTotal: 0, pack, detail })
    const s = buildSteps(bare, pack, undefined)
    expect(s.some((x) => x.title === 'Check ownership')).toBe(false)
    expect(s.some((x) => x.title === 'Scan the billing links')).toBe(true)
  })
})
