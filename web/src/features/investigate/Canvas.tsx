// The investigation canvas: an SVG scene graph with its own camera, so entities can be real objects (tile, icon, id,
// type, risk) instead of dots. Interaction model: drag the background to pan, wheel to zoom at the cursor, drag a tile
// to move it (it then stays where it was put), click to select, shift-click to add, double-click to expand a
// neighbourhood. Motion only ever means something: the camera eases, selected neighbourhoods come forward while the
// rest recedes, a signal travels along a link when evidence flows through it, and new links draw themselves.
import { Building2, FileText, Hospital, Stethoscope, User } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { EdgeKind, EntityType, GEdge, GNode, Model, Selection } from './model'
import { KIND_LABEL, TYPE_LABEL, nodeBounds } from './model'

export interface CanvasHandle {
  fit: (ids?: Iterable<string>) => void
  focus: (id: string) => void
  zoom: (factor: number) => void
}

export interface Signal { key: string; edgeId: string; from: string; start: number; dur: number }

interface Props {
  model: Model
  visibleNodes: Set<string>
  visibleEdges: Set<string>
  selection: Selection
  multi: Set<string>
  /** when set, everything outside it recedes */
  focus: Set<string> | null
  focusEdges: Set<string> | null
  hot: Set<string>
  active: Set<string>
  activeKey: string
  signals: Signal[]
  onSelect: (sel: Selection, additive: boolean) => void
  onExpand: (id: string) => void
  onMoved: () => void
  tick: number
  /** pixels at the bottom covered by overlays (the playback dock); the camera fits above them */
  bottomInset?: number
  className?: string
}

const TYPE_COLOR: Record<EntityType, string> = {
  provider: 'var(--chart-2)', owner: 'var(--chart-4)', member: 'var(--chart-1)', claim: 'var(--chart-3)', facility: 'var(--chart-5)',
}
const KIND_COLOR: Record<EdgeKind, string> = {
  owner: 'var(--chart-4)', billed: 'var(--fg-3)', referral: 'var(--chart-2)', claim: 'var(--chart-3)', serves: 'var(--chart-1)', facility: 'var(--chart-5)',
}
const RISK_COLOR = { HIGH: 'var(--tier-high)', MEDIUM: 'var(--tier-medium)', LOW: 'var(--tier-monitor)', MONITOR: 'var(--tier-monitor)' } as const
const ICON = { provider: Stethoscope, owner: Building2, member: User, claim: FileText, facility: Hospital }

interface Cam { x: number; y: number; k: number }
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

function borderPoint(n: GNode, toward: { x: number; y: number }, pad = 4) {
  const dx = toward.x - n.x, dy = toward.y - n.y
  const hw = n.w / 2 + pad, hh = n.h / 2 + pad
  if (dx === 0 && dy === 0) return { x: n.x, y: n.y }
  const s = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity)
  return { x: n.x + dx * s, y: n.y + dy * s }
}

interface Geo { d: string; mid: { x: number; y: number }; p0: { x: number; y: number }; c: { x: number; y: number }; p2: { x: number; y: number }; len: number }
function geometry(a: GNode, b: GNode, curve: number): Geo {
  const p0 = borderPoint(a, b), p2 = borderPoint(b, a)
  const mx = (p0.x + p2.x) / 2, my = (p0.y + p2.y) / 2
  const dx = p2.x - p0.x, dy = p2.y - p0.y
  const len = Math.hypot(dx, dy) || 1
  const c = { x: mx - (dy / len) * curve * len, y: my + (dx / len) * curve * len }
  const mid = { x: 0.25 * p0.x + 0.5 * c.x + 0.25 * p2.x, y: 0.25 * p0.y + 0.5 * c.y + 0.25 * p2.y }
  return { d: `M${p0.x},${p0.y} Q${c.x},${c.y} ${p2.x},${p2.y}`, mid, p0, c, p2, len }
}
const at = (g: Geo, t: number) => ({
  x: (1 - t) * (1 - t) * g.p0.x + 2 * (1 - t) * t * g.c.x + t * t * g.p2.x,
  y: (1 - t) * (1 - t) * g.p0.y + 2 * (1 - t) * t * g.c.y + t * t * g.p2.y,
})

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(props, ref) {
  const { model, visibleNodes, visibleEdges, selection, multi, focus, focusEdges, hot, active, activeKey, signals, onSelect, onExpand, onMoved, tick } = props
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 900, h: 560 })
  const [cam, setCam] = useState<Cam>({ x: 450, y: 280, k: 0.8 })
  const camRef = useRef(cam)
  camRef.current = cam
  const [hover, setHover] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [now, setNow] = useState(() => performance.now())
  const raf = useRef(0)
  const fitted = useRef(false)
  const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const nodes = useMemo(() => [...model.nodes.values()].filter((n) => visibleNodes.has(n.id)), [model, visibleNodes, tick])
  const edges = useMemo(() => model.edges.filter((e) => visibleEdges.has(e.id) && visibleNodes.has(e.source) && visibleNodes.has(e.target)), [model, visibleEdges, visibleNodes])

  // parallel links between the same pair fan out; everything else bows gently
  const geos = useMemo(() => {
    const out = new Map<string, Geo>()
    const seen = new Map<string, number>()
    for (const e of edges) {
      const a = model.nodes.get(e.source)!, b = model.nodes.get(e.target)!
      const key = [e.source, e.target].sort().join('|')
      const i = seen.get(key) ?? 0
      seen.set(key, i + 1)
      const hash = [...e.id].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) | 0, 7)
      const base = e.kind === 'serves' || e.kind === 'claim' ? 0.04 : 0.1
      out.set(e.id, geometry(a, b, (hash % 2 ? 1 : -1) * base + i * 0.12))
    }
    return out
  }, [edges, model, tick])

  // ------------------------------------------------------------------------------------------------ camera
  const animate = useCallback((to: Cam, ms = 650) => {
    cancelAnimationFrame(raf.current)
    const from = camRef.current
    if (reduced || ms === 0) { setCam(to); return }
    const t0 = performance.now()
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      const e = ease(p)
      setCam({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k * Math.pow(to.k / from.k, e) })
      if (p < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
  }, [reduced])

  const fitTo = useCallback((ids?: Iterable<string>, ms = 650) => {
    const inset = props.bottomInset ?? 0
    const list = (ids ? [...ids].map((i) => model.nodes.get(i)) : nodes).filter((n): n is GNode => !!n && visibleNodes.has(n.id))
    const b = nodeBounds(list.length ? list : nodes, 70)
    const usable = Math.max(120, size.h - inset)
    const k = Math.max(0.2, Math.min(1.35, Math.min(size.w / b.w, usable / b.h)))
    animate({ k, x: size.w / 2 - (b.x + b.w / 2) * k, y: usable / 2 - (b.y + b.h / 2) * k }, ms)
  }, [model, nodes, size, animate, visibleNodes, props.bottomInset])

  useImperativeHandle(ref, () => ({
    fit: (ids) => fitTo(ids),
    focus: (id) => {
      const n = model.nodes.get(id)
      if (!n) return
      const k = Math.max(camRef.current.k, 0.95)
      animate({ k, x: size.w / 2 - n.x * k, y: size.h / 2 - n.y * k })
    },
    zoom: (f) => {
      const c = camRef.current
      const k = Math.max(0.2, Math.min(2.6, c.k * f))
      const cx = size.w / 2, cy = size.h / 2
      animate({ k, x: cx - ((cx - c.x) / c.k) * k, y: cy - ((cy - c.y) / c.k) * k }, 220)
    },
  }), [fitTo, model, size, animate])

  useEffect(() => {
    const el = box.current
    if (!el) return
    setSize({ w: el.clientWidth || 900, h: el.clientHeight || 560 })
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 900, h: el.clientHeight || 560 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {          // first view: fit everything once the size is known
    if (!fitted.current && nodes.length && size.w > 0) {
      fitted.current = true
      if (reduced) { fitTo(undefined, 0); return }
      setCam({ x: size.w / 2, y: size.h / 2, k: 0.22 })          // the camera flies in from far away
      window.setTimeout(() => fitTo(undefined, 1300), 60)
    }
  }, [nodes.length, size.w, fitTo])

  useEffect(() => {          // wheel zoom around the cursor (needs a non-passive listener)
    const el = box.current
    if (!el) return
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      cancelAnimationFrame(raf.current)
      const r = el.getBoundingClientRect()
      const px = ev.clientX - r.left, py = ev.clientY - r.top
      const c = camRef.current
      const k = Math.max(0.2, Math.min(2.6, c.k * Math.exp(-ev.deltaY * 0.0014)))
      setCam({ k, x: px - ((px - c.x) / c.k) * k, y: py - ((py - c.y) / c.k) * k })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // signals need a steady clock only while any are in flight
  useEffect(() => {
    if (signals.length === 0) return
    let id = 0
    const loop = (t: number) => { setNow(t); id = requestAnimationFrame(loop) }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [signals.length])

  // --------------------------------------------------------------------------------------- pointer handling
  const drag = useRef<{ mode: 'pan' | 'node'; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; additive: boolean } | null>(null)

  const down = (ev: React.PointerEvent, id?: string) => {
    if (ev.button !== 0) return
    ev.stopPropagation()
    ;(ev.currentTarget as Element).setPointerCapture?.(ev.pointerId)
    cancelAnimationFrame(raf.current)
    const n = id ? model.nodes.get(id) : undefined
    drag.current = { mode: n ? 'node' : 'pan', id, sx: ev.clientX, sy: ev.clientY, ox: n ? n.x : camRef.current.x, oy: n ? n.y : camRef.current.y, moved: false, additive: ev.shiftKey || ev.metaKey || ev.ctrlKey }
  }
  const move = (ev: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = ev.clientX - d.sx, dy = ev.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) { d.moved = true; setDragging(true) }
    if (d.mode === 'pan') setCam({ ...camRef.current, x: d.ox + dx, y: d.oy + dy })
    else if (d.id) {
      const n = model.nodes.get(d.id)!
      n.x = d.ox + dx / camRef.current.k
      n.y = d.oy + dy / camRef.current.k
      n.pinned = true                      // placed by the investigator: never moved by a layout again
      onMoved()
    }
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (!d) return
    if (!d.moved) {
      if (d.mode === 'node' && d.id) onSelect({ kind: 'node', id: d.id }, d.additive)
      else if (d.mode === 'pan') onSelect({ kind: 'none' }, false)
    }
  }

  // ------------------------------------------------------------------------------------------------ drawing
  const dim = (id: string, edge = false) => (focus ? !(edge ? focusEdges?.has(id) : focus.has(id)) : false)
  const selectedId = selection.kind === 'node' ? selection.id : undefined
  const selectedEdge = selection.kind === 'edge' ? selection.id : undefined
  const hoverHood = useMemo(() => {
    if (!hover || hover.kind !== 'node') return null
    const s = new Set([hover.id, ...(model.adjacency.get(hover.id) ?? [])])
    return s
  }, [hover, model])

  const tip = hover?.kind === 'node' ? model.nodes.get(hover.id) : undefined
  const edgeTip = hover?.kind === 'edge' ? model.edges.find((e) => e.id === hover.id) : undefined

  const edgeLabelFor = (e: GEdge) => hover?.id === e.id || selectedEdge === e.id || (focusEdges?.has(e.id) ?? false) || (cam.k > 1.15 && e.kind !== 'serves' && e.kind !== 'claim')

  return (
    <div ref={box} className={`relative h-full w-full touch-none select-none overflow-hidden ${props.className ?? ''}`} style={{ cursor: dragging ? 'grabbing' : 'grab' }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(circle,var(--grid-line)_1.2px,transparent_1.2px)]"
        style={{ backgroundSize: `${28 * Math.max(0.6, cam.k)}px ${28 * Math.max(0.6, cam.k)}px`, backgroundPosition: `${cam.x * 0.6}px ${cam.y * 0.6}px` }} />
      <svg
        role="application"
        aria-label={`Relationship graph with ${nodes.length} entities and ${edges.length} links. Tab to move between entities, Enter to select, Escape to clear.`}
        className="absolute inset-0 h-full w-full"
        onPointerDown={(e) => down(e)}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={(e) => { if (e.key === 'Escape') onSelect({ kind: 'none' }, false) }}
      >
        <defs>
          {(Object.keys(KIND_COLOR) as EdgeKind[]).map((k) => (
            <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M1,1.5 L8.5,5 L1,8.5 z" fill={KIND_COLOR[k]} />
            </marker>
          ))}
          <filter id="tile-shadow" x="-30%" y="-30%" width="160%" height="170%">
            <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#000" floodOpacity="0.16" />
          </filter>
        </defs>
        <g style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`, transformOrigin: '0 0' }}>
          {/* links */}
          <g>
            {edges.map((e) => {
              const g = geos.get(e.id)
              if (!g) return null
              const sel = selectedEdge === e.id
              const lit = sel || hover?.id === e.id || (hoverHood?.has(e.source) && hoverHood.has(e.target)) || (focusEdges?.has(e.id) ?? false)
              const faded = dim(e.id, true) || (hoverHood ? !(hoverHood.has(e.source) && hoverHood.has(e.target)) : false)
              const w = Math.min(4.2, 1.2 + Math.log2(1 + e.nClaims) * 0.55)
              const color = KIND_COLOR[e.kind]
              return (
                <g key={e.id} style={{ opacity: faded ? 0.1 : 1, transition: 'opacity .28s ease' }}>
                  <path
                    d={g.d} fill="none" stroke={color} strokeWidth={lit ? w + 1.2 : w} strokeLinecap="round" pathLength={1}
                    strokeDasharray={e.kind === 'owner' ? '0.02 0.012' : undefined} markerEnd={`url(#arrow-${e.kind})`}
                    className={e.kind === 'owner' ? 'edge-fade' : 'edge-draw'} style={{ opacity: lit ? 0.95 : e.kind === 'serves' ? 0.38 : 0.55, transition: 'stroke-width .2s ease, opacity .25s ease' }}
                  />
                  <path d={g.d} fill="none" stroke={color} strokeWidth={Math.max(1.5, w * 0.85)} strokeLinecap="round" strokeDasharray="1.5 17"
                    className={`edge-flow ${e.kind === 'claim' || e.kind === 'serves' ? 'edge-flow-fast' : ''}`} style={{ opacity: faded ? 0 : lit ? 0.95 : 0.42, pointerEvents: 'none' }} />
                  <path d={g.d} fill="none" stroke="transparent" strokeWidth={14} style={{ cursor: 'pointer' }}
                    onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => { ev.stopPropagation(); onSelect({ kind: 'edge', id: e.id }, ev.shiftKey) }}
                    onPointerEnter={() => setHover({ kind: 'edge', id: e.id })} onPointerLeave={() => setHover(null)} />
                  {edgeLabelFor(e) && (
                    <g transform={`translate(${g.mid.x} ${g.mid.y})`} style={{ pointerEvents: 'none' }}>
                      <rect x={-(e.label.length * 3.1 + 9)} y={-9} width={e.label.length * 6.2 + 18} height={18} rx={9} fill="var(--card)" stroke={color} strokeOpacity={0.55} />
                      <text textAnchor="middle" y={3.5} fontSize={10} fontFamily="Geist Mono Variable, monospace" fill="var(--fg)">{e.label}</text>
                    </g>
                  )}
                </g>
              )
            })}
          </g>

          {/* signals travelling along links */}
          <g style={{ pointerEvents: 'none' }}>
            {signals.map((s) => {
              const g = geos.get(s.edgeId)
              const e = model.edges.find((x) => x.id === s.edgeId)
              if (!g || !e) return null
              const p = Math.min(1, Math.max(0, (now - s.start) / s.dur))
              if (p <= 0 || p >= 1) return null
              const t = s.from === e.source ? ease(p) : 1 - ease(p)
              const head = at(g, t)
              const trail = [0.045, 0.1].map((d) => at(g, Math.min(1, Math.max(0, s.from === e.source ? t - d : t + d))))
              return (
                <g key={s.key}>
                  {trail.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={4 - i * 1.2} fill="var(--chart-2)" opacity={0.35 - i * 0.14} />)}
                  <circle cx={head.x} cy={head.y} r={9} fill="var(--chart-2)" opacity={0.16} />
                  <circle cx={head.x} cy={head.y} r={4.2} fill="var(--chart-2)" />
                </g>
              )
            })}
          </g>

          {/* entities */}
          <g>
            {nodes.map((n, idx) => {
              const sel = selectedId === n.id || multi.has(n.id)
              const faded = dim(n.id) || (hoverHood ? !hoverHood.has(n.id) : false)
              const color = TYPE_COLOR[n.type]
              const Icon = ICON[n.type]
              const isHot = hot.has(n.id), isActive = active.has(n.id)
              const risk = n.risk
              const pill = risk ? `${risk.level} ${risk.score.toFixed(2)}` : n.type === 'claim' ? n.stats.find((s) => s.label === 'Paid')?.value : undefined
              const pillColor = risk ? RISK_COLOR[risk.level] : color
              const bubbleY = -n.h / 2 + n.h * 0.31
              return (
                <g
                  key={n.id}
                  role="button" tabIndex={0} aria-label={`${TYPE_LABEL[n.type]} ${n.id}${risk ? `, ${risk.level} risk` : ''}`} aria-pressed={sel}
                  className={dragging ? '' : 'node-move'}
                  style={{ transform: `translate(${n.x}px, ${n.y}px)`, opacity: faded ? 0.16 : 1, transition: dragging ? 'opacity .25s' : 'transform .5s cubic-bezier(.2,.8,.2,1), opacity .28s ease', cursor: 'pointer', outline: 'none' }}
                  onPointerDown={(e) => down(e, n.id)}
                  onDoubleClick={(e) => { e.stopPropagation(); onExpand(n.id) }}
                  onPointerEnter={() => setHover({ kind: 'node', id: n.id })}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover({ kind: 'node', id: n.id })} onBlur={() => setHover(null)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect({ kind: 'node', id: n.id }, e.shiftKey) } }}
                >
                  <g className="node-in" style={{ animationDelay: `${Math.min(720, idx * 26)}ms` }}>
                    <g className="node-lift">
                    {(sel || isActive) && (
                      <rect key={sel ? 'sel' : activeKey} x={-n.w / 2 - 7} y={-n.h / 2 - 7} width={n.w + 14} height={n.h + 14} rx={22}
                        fill="none" stroke={sel ? color : 'var(--chart-2)'} strokeWidth={sel ? 2 : 1.5} opacity={sel ? 0.55 : 0.9} className={sel ? '' : 'ring-pulse'} />
                    )}
                    <rect x={-n.w / 2} y={-n.h / 2} width={n.w} height={n.h} rx={16} fill="var(--card)" filter="url(#tile-shadow)"
                      stroke={sel ? color : isHot ? 'var(--warn)' : isActive ? 'var(--chart-2)' : 'var(--border)'} strokeWidth={sel || isHot ? 2 : 1} />
                    <rect x={-n.w / 2} y={-n.h / 2} width={n.w} height={n.h} rx={16} fill={color} opacity={0.06} />
                    {n.role === 'PRIMARY' && <rect className="primary-breathe" x={-n.w / 2 - 4} y={-n.h / 2 - 4} width={n.w + 8} height={n.h + 8} rx={20} fill="none" stroke="var(--tier-high)" strokeWidth={1.4} />}
                    {n.role === 'PRIMARY' && <rect x={-n.w / 2 + 12} y={-n.h / 2} width={n.w - 24} height={3} rx={1.5} fill="var(--tier-high)" />}
                    <circle cx={0} cy={bubbleY} r={15} fill={color} opacity={0.16} />
                    <Icon x={-8.5} y={bubbleY - 8.5} width={17} height={17} color={color} strokeWidth={2} />
                    <text textAnchor="middle" y={-n.h / 2 + n.h * 0.66} fontSize={n.type === 'member' ? 11.5 : 13} fontWeight={650} fontFamily="Geist Mono Variable, monospace" fill="var(--fg)">{n.label}</text>
                    <text textAnchor="middle" y={-n.h / 2 + n.h * 0.81} fontSize={8.6} letterSpacing={1.1} fontFamily="Geist Mono Variable, monospace" fill="var(--fg-3)">{n.caption.toUpperCase()}</text>
                    {pill && (
                      <g transform={`translate(0 ${n.h / 2})`}>
                        <rect x={-(pill.length * 3.3 + 10)} y={-9} width={pill.length * 6.6 + 20} height={18} rx={9} fill="var(--card)" stroke={pillColor} strokeWidth={1.4} />
                        <text textAnchor="middle" y={3.4} fontSize={9.5} fontWeight={650} letterSpacing={0.6} fontFamily="Geist Mono Variable, monospace" fill={pillColor}>{pill}</text>
                      </g>
                    )}
                    </g>
                  </g>
                </g>
              )
            })}
          </g>
        </g>
      </svg>


      {nodes.length > 3 && <Minimap nodes={nodes} cam={cam} size={size} inset={props.bottomInset ?? 0} onJump={(x, y) => animate({ k: camRef.current.k, x: size.w / 2 - x * camRef.current.k, y: (size.h - (props.bottomInset ?? 0)) / 2 - y * camRef.current.k }, 450)} />}
      {/* hover card */}
      {tip && visibleNodes.has(tip.id) && !dragging && (
        <div className="pointer-events-none absolute z-10 w-56 rounded-xl border bg-popover/95 p-3 text-xs shadow-xl backdrop-blur"
          style={{ left: Math.min(size.w - 236, Math.max(8, cam.x + tip.x * cam.k + (tip.w / 2) * cam.k + 14)), top: Math.min(size.h - 150, Math.max(8, cam.y + tip.y * cam.k - 30)) }}>
          <p className="eyebrow">{TYPE_LABEL[tip.type]}</p>
          <p className="mono text-sm font-semibold text-foreground">{tip.id}</p>
          {tip.risk && <p className="mt-1" style={{ color: RISK_COLOR[tip.risk.level] }}>{tip.risk.level} risk · {tip.risk.score.toFixed(2)}</p>}
          <dl className="mt-1.5 space-y-0.5 text-muted-foreground">
            {[{ label: 'Links', value: String(model.adjacency.get(tip.id)?.size ?? 0) }, ...tip.stats.slice(0, 3)].map((s) => (
              <div key={s.label} className="flex justify-between gap-3"><dt>{s.label}</dt><dd className="text-foreground">{s.value}</dd></div>
            ))}
          </dl>
          <p className="mt-2 text-[10px] text-muted-foreground">Click to inspect · double-click to expand</p>
        </div>
      )}
      {edgeTip && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border bg-popover/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur">
          <span className="mono">{edgeTip.source}</span> <span className="text-muted-foreground">{KIND_LABEL[edgeTip.kind].toLowerCase()}</span> <span className="mono">{edgeTip.target}</span>
          {edgeTip.nClaims > 0 && <span className="text-muted-foreground"> · {edgeTip.nClaims} flagged</span>}
        </div>
      )}
    </div>
  )
})


const MINI_COLOR: Record<EntityType, string> = { provider: 'var(--chart-2)', owner: 'var(--chart-4)', member: 'var(--chart-1)', claim: 'var(--chart-3)', facility: 'var(--chart-5)' }

/** An overview of the whole network with the current view outlined; click anywhere on it to move there. */
function Minimap({ nodes, cam, size, inset, onJump }: { nodes: GNode[]; cam: Cam; size: { w: number; h: number }; inset: number; onJump: (x: number, y: number) => void }) {
  const b = nodeBounds(nodes, 40)
  const W = 168, H = 108
  const k = Math.min(W / b.w, H / b.h)
  const ox = (W - b.w * k) / 2, oy = (H - b.h * k) / 2
  const sx = (x: number) => ox + (x - b.x) * k, sy = (y: number) => oy + (y - b.y) * k
  const vx = -cam.x / cam.k, vy = -cam.y / cam.k, vw = size.w / cam.k, vh = (size.h - inset) / cam.k
  return (
    <svg aria-hidden width={W} height={H} className="absolute right-14 z-[5] cursor-crosshair overflow-hidden rounded-xl border bg-card/85 shadow-lg backdrop-blur transition-[bottom] duration-300"
      style={{ bottom: 12 + inset }}
      onPointerDown={(e) => {
        const r = (e.currentTarget as SVGElement).getBoundingClientRect()
        onJump(b.x + ((e.clientX - r.left) - ox) / k, b.y + ((e.clientY - r.top) - oy) / k)
      }}>
      {nodes.map((n) => <circle key={n.id} cx={sx(n.x)} cy={sy(n.y)} r={n.type === 'provider' ? 3.2 : 1.8} fill={MINI_COLOR[n.type]} opacity={0.85} />)}
      <rect x={sx(vx)} y={sy(vy)} width={Math.max(8, vw * k)} height={Math.max(6, vh * k)} rx={3} fill="var(--signal)" fillOpacity={0.08} stroke="var(--signal)" strokeWidth={1.2} />
    </svg>
  )
}
