// The investigation canvas page: the relationship graph as the hero, an inspector that rebuilds itself around the
// selection, a copilot that shares the graph's context and can drive it, and a playback of how the evidence builds up.
import { useQuery } from '@tanstack/react-query'
import { Crosshair, Layers, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, Play, RotateCcw, Search, Send, Sparkles, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '@/lib/api'
import { useMe } from '@/lib/auth'
import type { CaseDetail, ClaimsPage, EvidencePack, QueueResponse } from '@/lib/types'
import type { CaseGraph, CaseTimeline, GroundedOutput } from '@/lib/types2'
import { Canvas, type CanvasHandle, type Signal } from './Canvas'
import { Inspector } from './Inspector'
import { KIND_COLOR, RiskMeter, SimDock } from './SimDock'
import { type EntityType, type Reply, type Selection, answerLocally, briefFor, buildModel, edgesOf, neighborhood, TYPE_LABEL } from './model'
import { KIND_LABEL, buildSteps, stateAt } from './simulation'

interface Msg { role: 'user' | 'assistant'; text: string; citations?: string[]; badge?: string }
const MEMBER_COLLAPSE_AT = 18

export function InvestigateRedirect() {
  const q = useQuery<QueueResponse>({ queryKey: ['queue-top'], queryFn: () => api('/api/queue?horizon=90&capacityHours=1000'), staleTime: 60_000 })
  if (q.isError) return <p className="text-sm text-muted-foreground">The queue is not available, so there is no case to open.</p>
  if (!q.data) return <div className="h-[70vh] animate-pulse rounded-2xl bg-muted" />
  const first = q.data.items[0]
  if (!first) return <p className="text-sm text-muted-foreground">There are no cases in the queue to investigate.</p>
  return <Navigate to={`/investigate/${first.caseId}`} replace />
}

export function InvestigatePage() {
  const { caseId = '' } = useParams()
  const nav = useNavigate()
  const me = useMe().data
  const detail = useQuery<CaseDetail>({ queryKey: ['case', caseId], queryFn: () => api(`/api/cases/${caseId}`) })
  const packQ = useQuery<EvidencePack>({ queryKey: ['evidence', caseId], queryFn: () => api(`/api/cases/${caseId}/evidence`) })
  const graph = useQuery<CaseGraph>({ queryKey: ['graph', caseId], queryFn: () => api(`/api/cases/${caseId}/graph`) })
  const claims = useQuery<ClaimsPage>({ queryKey: ['inv-claims', caseId], queryFn: () => api(`/api/cases/${caseId}/claims?size=200`) })
  const timeline = useQuery<CaseTimeline>({ queryKey: ['timeline', caseId], queryFn: () => api(`/api/cases/${caseId}/timeline`) })
  const queue = useQuery<QueueResponse>({ queryKey: ['queue-top'], queryFn: () => api('/api/queue?horizon=90&capacityHours=1000'), staleTime: 60_000 })

  const [resetKey, setResetKey] = useState(0)
  const model = useMemo(() => {
    if (!graph.data) return null
    return buildModel({ caseId, graph: graph.data, claims: claims.data?.items ?? [], claimTotal: claims.data?.total ?? 0, pack: packQ.data, detail: detail.data })
  }, [caseId, graph.data, claims.data, packQ.data, detail.data, resetKey])   // eslint-disable-line react-hooks/exhaustive-deps

  if (graph.isError) {
    return (
      <div role="alert" className="mx-auto mt-20 max-w-md space-y-3 rounded-2xl border bg-card p-8 text-center">
        <p className="eyebrow">Investigation canvas</p>
        <h1 className="text-lg font-semibold">The relationship graph could not be loaded.</h1>
        <p className="text-sm text-muted-foreground">{graph.error instanceof ApiError ? graph.error.detail : 'Try again in a moment.'}</p>
        <button type="button" className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => void graph.refetch()}>Retry</button>
      </div>
    )
  }
  if (!model || !me) return <div className="h-[calc(100dvh-9rem)] animate-pulse rounded-2xl bg-muted" aria-busy="true" aria-label="Loading the investigation canvas" />
  return (
    <Workspace
      key={`${caseId}-${resetKey}`} model={model} caseId={caseId} detail={detail.data} pack={packQ.data} timeline={timeline.data}
      lines={claims.data?.items ?? []} queue={queue.data} role={me.role}
      onReset={() => setResetKey((k) => k + 1)} onCase={(id) => nav(`/investigate/${id}`)}
    />
  )
}

function Workspace(p: {
  model: ReturnType<typeof buildModel>; caseId: string; detail?: CaseDetail; pack?: EvidencePack; timeline?: CaseTimeline
  lines: import('@/lib/types').ClaimLine[]; queue?: QueueResponse; role: string; onReset: () => void; onCase: (id: string) => void
}) {
  const { model, caseId, detail, pack, timeline } = p
  const canvas = useRef<CanvasHandle>(null)
  const shell = useRef<HTMLDivElement>(null)
  const [tick, setTick] = useState(0)
  const [selection, setSelection] = useState<Selection>({ kind: 'none' })
  const [multi, setMulti] = useState<Set<string>>(new Set())
  const [focus, setFocus] = useState<Set<string> | null>(null)
  const [focusEdges, setFocusEdges] = useState<Set<string> | null>(null)
  const [types, setTypes] = useState<Record<EntityType, boolean>>({ provider: true, owner: true, member: true, claim: false, facility: true })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [panel, setPanel] = useState(true)
  const [tab, setTab] = useState<'inspect' | 'copilot' | 'events'>('inspect')
  const [search, setSearch] = useState('')
  const [full, setFull] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [signals, setSignals] = useState<Signal[]>([])

  // ------------------------------------------------------------------------------------------- simulation
  const steps = useMemo(() => buildSteps(model, pack, detail?.defaultAction), [model, pack, detail])
  const [sim, setSim] = useState<{ on: boolean; index: number; playing: boolean; speed: number }>({ on: false, index: 0, playing: false, speed: 1 })
  const state = useMemo(() => (sim.on ? stateAt(steps, sim.index) : null), [sim.on, sim.index, steps])

  const say = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast((c) => (c === m ? null : c)), 2600) }, [])

  const memberCount = useMemo(() => [...model.nodes.values()].filter((n) => n.type === 'member').length, [model])
  const visibleNodes = useMemo(() => {
    if (state) return state.nodes
    const out = new Set<string>()
    for (const n of model.nodes.values()) {
      if (!types[n.type]) continue
      if (n.type === 'member' && memberCount > MEMBER_COLLAPSE_AT) {
        const near = [...(model.adjacency.get(n.id) ?? [])]
        if (!near.some((x) => expanded.has(x)) && !(selection.kind === 'node' && selection.id === n.id)) continue
      }
      out.add(n.id)
    }
    return out
  }, [state, model, types, expanded, memberCount, selection, tick])   // eslint-disable-line react-hooks/exhaustive-deps
  const visibleEdges = useMemo(() => {
    if (state) return state.edges
    const out = new Set<string>()
    for (const e of model.edges) {
      if (!visibleNodes.has(e.source) || !visibleNodes.has(e.target)) continue
      // when claims are shown they replace the aggregate provider-to-member billing link for the same member
      if (e.kind === 'billed' && types.claim) {
        const sourceClaims = [...(model.adjacency.get(e.source) ?? [])].filter((x) => model.nodes.get(x)?.type === 'claim')
        const memberHas = sourceClaims.some((c) => model.adjacency.get(c)?.has(e.target))
        if (memberHas) continue
      }
      out.add(e.id)
    }
    return out
  }, [state, model, visibleNodes, types.claim])

  const spawn = useCallback((list: { edgeId: string; from: string }[], speed: number) => {
    const t = performance.now()
    const next = list.map((s, i) => ({ key: `${s.edgeId}-${t}-${i}`, edgeId: s.edgeId, from: s.from, start: t + i * 70, dur: 950 / speed }))
    setSignals((cur) => [...cur, ...next])
    window.setTimeout(() => setSignals((cur) => cur.filter((x) => !next.includes(x))), 950 / speed + next.length * 70 + 120)
  }, [])

  const enter = useCallback((i: number, signalsToo: boolean, speed: number) => {
    const s = steps[i]
    if (!s) return
    if (s.select) setSelection({ kind: 'node', id: s.select })
    setFocus(null); setFocusEdges(null)
    window.setTimeout(() => canvas.current?.fit(s.focus), 30)
    if (signalsToo && s.signals.length) spawn(s.signals, speed)
  }, [steps, spawn])

  const start = () => {
    setSim({ on: true, index: 0, playing: true, speed: sim.speed })
    setTab('events'); setPanel(true); setMulti(new Set()); setFocus(null); setFocusEdges(null)
    window.setTimeout(() => enter(0, true, sim.speed), 40)
  }
  const stop = () => { setSim((s) => ({ ...s, on: false, playing: false })); setSignals([]); window.setTimeout(() => canvas.current?.fit(), 60) }
  const goto = (i: number, forward: boolean) => {
    const idx = Math.max(0, Math.min(steps.length - 1, i))
    setSim((s) => ({ ...s, index: idx }))
    enter(idx, forward, sim.speed)
  }

  useEffect(() => {          // auto-advance while playing
    if (!sim.on || !sim.playing) return
    if (sim.index >= steps.length - 1) { setSim((s) => ({ ...s, playing: false })); return }
    const id = window.setTimeout(() => goto(sim.index + 1, true), 2900 / sim.speed)
    return () => window.clearTimeout(id)
  }, [sim.on, sim.playing, sim.index, sim.speed, steps.length])   // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------------------------------ selection
  const select = (sel: Selection, additive: boolean) => {
    if (sel.kind === 'none') { setSelection(sel); setFocus(null); setFocusEdges(null); setMulti(new Set()); return }
    if (additive && sel.kind === 'node' && sel.id) {
      setMulti((m) => { const n = new Set(m); if (selection.kind === 'node' && selection.id) n.add(selection.id); n.has(sel.id!) ? n.delete(sel.id!) : n.add(sel.id!); return n })
      setSelection(sel)
      return
    }
    setMulti(new Set())
    setSelection(sel)
    if (sel.kind === 'node' && sel.id) {
      const hood = neighborhood(model, sel.id, 1)
      setFocus(hood); setFocusEdges(edgesOf(model, hood))
      window.setTimeout(() => canvas.current?.fit(hood), 20)
    } else if (sel.kind === 'edge') {
      const e = model.edges.find((x) => x.id === sel.id)
      if (e) { setFocus(new Set([e.source, e.target])); setFocusEdges(new Set([e.id])); window.setTimeout(() => canvas.current?.fit([e.source, e.target]), 20) }
    }
    setTab((t) => (t === 'events' && !sim.on ? 'inspect' : t))
  }
  const expand = (id: string) => {
    setExpanded((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n })
    window.setTimeout(() => canvas.current?.fit([id, ...(model.adjacency.get(id) ?? [])]), 40)
  }

  // ---------------------------------------------------------------------------------------------- search
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return [...model.nodes.values()].filter((n) => n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q)).slice(0, 6)
  }, [search, model])
  const reveal = (id: string) => {
    const n = model.nodes.get(id)
    if (!n) return
    if (n.type === 'claim' && !types.claim) setTypes((t) => ({ ...t, claim: true }))
    if (n.type === 'member') setExpanded((e) => new Set([...e, ...(model.adjacency.get(id) ?? [])]))
    if (sim.on) stop()
    select({ kind: 'node', id }, false)
    setSearch('')
    window.setTimeout(() => canvas.current?.focus(id), 60)
  }

  // ------------------------------------------------------------------------------------------- copilot
  const apply = (r: Reply) => {
    if (r.showClaims) setTypes((t) => ({ ...t, claim: true }))
    if (r.focus) { setFocus(r.focus); setFocusEdges(r.focusEdges ?? null); window.setTimeout(() => canvas.current?.fit(r.focus), 80) }
    if (r.path && r.focusEdges) spawn([...r.focusEdges].map((id) => ({ edgeId: id, from: model.edges.find((e) => e.id === id)!.source })), 1)
  }
  const ask = async (q: string) => {
    const text = q.trim()
    if (!text || busy) return
    setTab('copilot'); setPanel(true); setQuestion('')
    setMsgs((m) => [...m, { role: 'user', text }])
    const ctx = { model, pack, detail, selection }
    // the risk question during playback is answered from the steps that have actually played
    if (/why.*(risk).*(increase|go up|rise|escalat|higher)|risk.*(increase|went up|rose)/i.test(text) && sim.on && steps[sim.index]) {
      const prev = steps[Math.max(0, sim.index - 1)]
      const s = steps[sim.index]
      const reply = `The risk moved from ${prev.risk.toFixed(2)} to ${s.risk.toFixed(2)} at "${s.title}". ${s.body}`
      setMsgs((m) => [...m, { role: 'assistant', text: reply, citations: s.evidenceId ? [s.evidenceId] : [], badge: 'from the evidence on screen' }])
      return
    }
    const local = answerLocally(text, ctx)
    if (local) {
      apply(local)
      setMsgs((m) => [...m, { role: 'assistant', text: local.text, citations: local.citations, badge: 'graph answer' }])
      return
    }
    setBusy(true)
    try {
      const r = await api<GroundedOutput & { question: string }>(`/api/cases/${caseId}/copilot`, { method: 'POST', body: { question: text } })
      const sentences = r.content.sections?.answer ?? []
      const body = r.content.answerable === false ? (r.content.notInPack ?? 'The evidence pack does not contain that.') : sentences.map((s) => s.text).join(' ')
      setMsgs((m) => [...m, { role: 'assistant', text: body, citations: sentences.flatMap((s) => s.citations), badge: r.badge === 'VALIDATED' ? 'validated AI' : 'deterministic fallback' }])
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: e instanceof ApiError ? e.detail : 'The copilot could not answer right now.', badge: 'error' }])
    } finally {
      setBusy(false)
    }
  }

  // --------------------------------------------------------------------------------------------- chrome
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void shell.current?.requestFullscreen?.() }
  const toggleType = (t: EntityType) => { setTypes((x) => ({ ...x, [t]: !x[t] })); window.setTimeout(() => canvas.current?.fit(), 80) }
  const brief = briefFor({ model, pack, detail, selection, visible: visibleNodes })
  const claimCount = [...model.nodes.values()].filter((n) => n.type === 'claim').length
  const level = detail?.tier
  const risk = state ? state.risk : model.risk?.score ?? 0

  const chip = 'inline-flex h-8 items-center gap-1.5 rounded-full border bg-background/70 px-3 text-xs font-medium backdrop-blur transition hover:bg-muted active:scale-[0.97] disabled:opacity-50 aria-pressed:border-[var(--signal)] aria-pressed:bg-muted'

  return (
    <div ref={shell} className={`flex flex-col gap-3 bg-background ${full ? 'h-screen p-4' : 'h-[calc(100dvh-8.5rem)] min-h-[34rem]'}`}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="eyebrow">Investigation canvas</p>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold leading-tight">
            <span className="mono">{caseId}</span>
            {level && <span className={`chip ${level === 'HIGH' ? 'chip-corr' : ''}`}>{level}</span>}
            {sim.on && <span className="chip chip-signal">simulating</span>}
          </h1>
        </div>
        {p.queue && p.queue.items.length > 1 && (
          <label className="text-xs text-muted-foreground">
            <span className="sr-only">Switch case</span>
            <select value={caseId} onChange={(e) => p.onCase(e.target.value)} className="h-8 rounded-full border bg-transparent px-3 text-xs text-foreground">
              {p.queue.items.map((i) => <option key={i.caseId} value={i.caseId}>{i.caseId} · {i.tier.toLowerCase()}</option>)}
            </select>
          </label>
        )}
        <Link to={`/cases/${caseId}`} className="text-xs underline underline-offset-2">Open case workspace</Link>
        <div className="ml-auto flex items-center gap-2">
          <RiskMeter value={risk} level={level} />
          <button type="button" onClick={sim.on ? stop : start} className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-[0_10px_30px_-12px_var(--glow)] transition hover:opacity-90 active:scale-[0.98]">
            {sim.on ? <><X aria-hidden className="h-4 w-4" /> Exit simulation</> : <><Play aria-hidden className="h-4 w-4" /> Simulate investigation</>}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-3">
        <section aria-label="Relationship graph" className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border bg-card">
          <Canvas
            ref={canvas} model={model} visibleNodes={visibleNodes} visibleEdges={visibleEdges} selection={selection} multi={multi}
            focus={focus} focusEdges={focusEdges} hot={state?.hot ?? new Set()} active={state?.active ?? new Set()} activeKey={`${sim.index}`}
            signals={signals} bottomInset={sim.on ? 120 : 0} onSelect={select} onExpand={expand} onMoved={() => setTick((t) => t + 1)} tick={tick}
          />

          {/* toolbar */}
          <div className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-start gap-2">
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search P-0044, a member, a claim…" aria-label="Search the network"
                onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) reveal(matches[0].id); if (e.key === 'Escape') setSearch('') }}
                className="h-8 w-60 rounded-full border bg-background/80 pl-8 pr-3 text-xs outline-none backdrop-blur transition focus:w-72 focus:border-[var(--signal)]" />
              {matches.length > 0 && (
                <ul role="listbox" aria-label="Search results" className="absolute mt-1.5 w-72 overflow-hidden rounded-xl border bg-popover p-1 text-xs shadow-xl">
                  {matches.map((n) => (
                    <li key={n.id}><button type="button" role="option" aria-selected="false" onClick={() => reveal(n.id)} className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-muted"><span className="mono">{n.id}</span><span className="text-muted-foreground">{TYPE_LABEL[n.type]}</span></button></li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show entity types">
              {(['provider', 'owner', 'member', 'claim'] as EntityType[]).map((t) => (
                <button key={t} type="button" aria-pressed={types[t]} onClick={() => toggleType(t)} className={chip} disabled={!!state}>
                  {t === 'claim' && <Layers aria-hidden className="h-3 w-3" />}{TYPE_LABEL[t]}s{t === 'claim' && claimCount ? ` (${claimCount})` : ''}
                </button>
              ))}
            </div>
          </div>
          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            <button type="button" aria-label="Zoom in" className={`${chip} !w-8 justify-center !px-0`} onClick={() => canvas.current?.zoom(1.3)}><ZoomIn aria-hidden className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="Zoom out" className={`${chip} !w-8 justify-center !px-0`} onClick={() => canvas.current?.zoom(1 / 1.3)}><ZoomOut aria-hidden className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="Fit the whole network" className={`${chip} !w-8 justify-center !px-0`} onClick={() => canvas.current?.fit()}><Crosshair aria-hidden className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="Centre the selected entity" disabled={selection.kind !== 'node'} className={`${chip} !w-8 justify-center !px-0`} onClick={() => selection.id && canvas.current?.focus(selection.id)}><Sparkles aria-hidden className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="Reset the layout" className={`${chip} !w-8 justify-center !px-0`} onClick={() => { p.onReset(); say('Layout reset') }}><RotateCcw aria-hidden className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label={full ? 'Exit full screen' : 'Enter full screen'} className={`${chip} !w-8 justify-center !px-0`} onClick={toggleFull}>{full ? <Minimize2 aria-hidden className="h-3.5 w-3.5" /> : <Maximize2 aria-hidden className="h-3.5 w-3.5" />}</button>
            <button type="button" aria-label={panel ? 'Hide the inspector' : 'Show the inspector'} className={`${chip} !w-8 justify-center !px-0`} onClick={() => setPanel((v) => !v)}>{panel ? <PanelRightClose aria-hidden className="h-3.5 w-3.5" /> : <PanelRightOpen aria-hidden className="h-3.5 w-3.5" />}</button>
          </div>

          {/* legend + hints */}
          {!sim.on && (
            <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border bg-background/80 px-3 py-1.5 text-[0.68rem] backdrop-blur">
              {(['provider', 'owner', 'member', 'claim'] as EntityType[]).map((t) => (
                <span key={t} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: { provider: 'var(--chart-2)', owner: 'var(--chart-4)', member: 'var(--chart-1)', claim: 'var(--chart-3)', facility: 'var(--chart-5)' }[t] }} />{TYPE_LABEL[t]}</span>
              ))}
              <span className="text-muted-foreground">drag to move · scroll to zoom · double-click to expand · links are derived, not confirmed</span>
            </div>
          )}
          {toast && <p role="status" className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full border bg-popover px-4 py-2 text-xs shadow-lg">{toast}</p>}
          {memberCount > MEMBER_COLLAPSE_AT && !sim.on && <p className="absolute right-14 top-3 rounded-full border bg-background/80 px-3 py-1 text-[0.68rem] text-muted-foreground backdrop-blur">{memberCount} members collapsed · double-click a provider to expand</p>}

          {/* playback */}
          {sim.on && steps[sim.index] && (
            <div key={steps[sim.index].id} className="step-in pointer-events-none absolute left-1/2 top-16 z-[6] w-[min(34rem,calc(100%-8rem))] -translate-x-1/2 rounded-2xl border bg-popover/95 p-4 shadow-2xl backdrop-blur" role="status">
              <p className="flex items-center gap-2 text-[0.68rem]">
                <span className="mono rounded-full border px-1.5 py-0.5" style={{ color: KIND_COLOR[steps[sim.index].kind], borderColor: `color-mix(in oklab, ${KIND_COLOR[steps[sim.index].kind]} 45%, transparent)` }}>{KIND_LABEL[steps[sim.index].kind]}</span>
                {steps[sim.index].evidenceId && <span className="mono text-muted-foreground">evidence {steps[sim.index].evidenceId}</span>}
                <span className="mono ml-auto text-muted-foreground">risk {steps[sim.index].risk.toFixed(2)}</span>
              </p>
              <p className="mt-1.5 text-[0.95rem] font-semibold leading-snug">{steps[sim.index].title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{steps[sim.index].body}</p>
            </div>
          )}
          {sim.on && (
            <div className="absolute inset-x-3 bottom-3">
              <SimDock steps={steps} index={sim.index} playing={sim.playing} speed={sim.speed}
                onPlay={() => { if (sim.index >= steps.length - 1) { setSim((s) => ({ ...s, index: 0, playing: true })); enter(0, true, sim.speed) } else setSim((s) => ({ ...s, playing: true })) }}
                onPause={() => setSim((s) => ({ ...s, playing: false }))}
                onStep={(d) => { setSim((s) => ({ ...s, playing: false })); goto(sim.index + d, d > 0) }}
                onRestart={() => { setSim((s) => ({ ...s, index: 0, playing: true })); enter(0, true, sim.speed) }}
                onSeek={(i) => { setSim((s) => ({ ...s, playing: false })); goto(i, i === sim.index + 1) }}
                onSpeed={(s) => setSim((x) => ({ ...x, speed: s }))} />
            </div>
          )}
        </section>

        {/* inspector */}
        <aside aria-label="Investigation inspector" className={`flex shrink-0 flex-col overflow-hidden rounded-2xl border bg-card transition-[width,opacity,margin] duration-300 ease-out ${panel ? 'w-[24rem] opacity-100' : 'pointer-events-none -ml-3 w-0 border-0 opacity-0'}`}>
          <div role="tablist" aria-label="Inspector sections" className="flex border-b text-xs">
            {([['inspect', 'Inspector'], ['copilot', 'Copilot'], ['events', sim.on ? `Events (${sim.index + 1})` : 'Events']] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex-1 px-3 py-2.5 font-medium transition ${tab === k ? 'border-b-2 border-[var(--signal)] text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {tab === 'inspect' && (
              <Inspector ctx={{ model, pack, detail, timeline, lines: p.lines, selection, simRisk: state ? state.risk : null, visible: visibleNodes, canGenerate: p.role !== 'AUDITOR', onSelect: (s) => select(s, false), onFocus: (ids) => { const set = new Set(ids); setFocus(set); setFocusEdges(edgesOf(model, set)); canvas.current?.fit(set) }, onAsk: (q) => void ask(q) }} />
            )}
            {tab === 'copilot' && (
              <div className="flex h-full flex-col">
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
                  <div className="rounded-xl border bg-muted/40 p-3 text-[13px] leading-relaxed">
                    <p className="eyebrow">Context</p>
                    <p className="mt-1">{brief.text}</p>
                  </div>
                  {msgs.map((m, i) => (
                    <div key={i} className={m.role === 'user' ? 'ml-8 rounded-2xl rounded-br-sm bg-muted px-3 py-2 text-[13px]' : 'mr-4 space-y-1.5 rounded-2xl rounded-bl-sm border px-3 py-2.5 text-[13px] leading-relaxed'}>
                      <p>{m.text}</p>
                      {m.role === 'assistant' && (
                        <p className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {m.badge && <span className="chip chip-signal">{m.badge}</span>}
                          {m.citations?.slice(0, 6).map((c) => <span key={c} className="mono rounded border px-1 text-[0.62rem] text-muted-foreground">{c}</span>)}
                        </p>
                      )}
                    </div>
                  ))}
                  {busy && <div role="status" aria-label="Thinking" className="h-9 w-2/3 animate-pulse rounded-2xl bg-muted" />}
                </div>
                <div className="space-y-2 border-t p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {brief.suggestions.slice(0, 4).map((s) => (
                      <button key={s} type="button" onClick={() => void ask(s)} disabled={busy} className="mono rounded-full border px-2.5 py-1 text-[0.68rem] transition hover:border-[var(--signal)] hover:bg-muted disabled:opacity-50">{s}</button>
                    ))}
                  </div>
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(question) }}>
                    <label className="sr-only" htmlFor="inv-q">Ask the copilot</label>
                    <input id="inv-q" value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about this network…" className="h-9 min-w-0 flex-1 rounded-full border bg-transparent px-3 text-sm outline-none focus:border-[var(--signal)]" />
                    <button type="submit" aria-label="Send" disabled={!question.trim() || busy} className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 active:scale-95 disabled:opacity-40"><Send aria-hidden className="h-3.5 w-3.5" /></button>
                  </form>
                  <p className="text-[0.65rem] text-muted-foreground">Graph questions are answered from the records on screen. Other questions use the validated case copilot.</p>
                </div>
              </div>
            )}
            {tab === 'events' && (
              <div className="h-full overflow-y-auto p-4">
                {!sim.on ? (
                  <div className="space-y-3 text-sm">
                    <p className="eyebrow">Investigation events</p>
                    <p className="text-muted-foreground">Press “Simulate investigation” to watch the evidence build up, one relationship at a time. Every step is read from this case's own records.</p>
                    <p className="text-xs text-muted-foreground">{steps.length} steps are ready: {[...new Set(steps.map((s) => KIND_LABEL[s.kind]))].join(', ').toLowerCase()}.</p>
                  </div>
                ) : (
                  <ol className="relative space-y-3 border-l pl-5">
                    {steps.slice(0, sim.index + 1).map((s, i) => (
                      <li key={s.id} className="relative">
                        <span aria-hidden className="absolute -left-[1.62rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-card" style={{ background: KIND_COLOR[s.kind] }} />
                        <button type="button" onClick={() => goto(i, false)} className={`w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-muted ${i === sim.index ? 'bg-muted/60' : ''}`}>
                          <p className="flex items-center gap-2 text-[0.68rem]"><span className="mono" style={{ color: KIND_COLOR[s.kind] }}>{KIND_LABEL[s.kind]}</span><span className="mono text-muted-foreground">risk {s.risk.toFixed(2)}</span></p>
                          <p className="text-[13px] font-medium">{s.title}</p>
                          <p className="text-xs text-muted-foreground">{s.body}</p>
                          {s.evidenceId && <p className="mono mt-1 text-[0.62rem] text-muted-foreground">{s.evidenceId}</p>}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
