// The ClaimShield workflow drawn as a living loop instead of a row of boxes: claims become signals, signals are
// corroborated into evidence, evidence becomes a case, a person decides, and the decision becomes institutional
// knowledge that feeds the next case. A few small "claims" travel the loop on a knotted, non-linear path; each stage
// lights up and names itself as one passes. Purely decorative and labelled as such: nothing here is data.
import { useEffect, useMemo, useRef } from 'react'

const STAGES = [
  { label: 'Claims', note: 'synthetic billing history' },
  { label: 'Signals', note: 'rules, peers, history, network' },
  { label: 'Corroboration', note: 'independent channels agree' },
  { label: 'Evidence', note: 'sealed, hashed packs' },
  { label: 'SIU case', note: 'ranked by risk and effort' },
  { label: 'Human decision', note: 'two people approve' },
  { label: 'Second Brain', note: 'governed lessons' },
]
const W = 1200, H = 720, CX = W / 2, CY = H / 2
const point = (t: number) => ({ x: CX + 400 * Math.sin(2 * t + 0.35), y: CY + 215 * Math.sin(3 * t + 0.9) })
const SAMPLES = 720
const TAU = Math.PI * 2

export function WorkflowOrbit({ className = '' }: { className?: string }) {
  const parts = useRef<(SVGGElement | null)[]>([])
  const trails = useRef<(SVGPathElement | null)[]>([])
  const layer = useRef<SVGGElement>(null)
  const rings = useRef<SVGGElement>(null)
  const nodes = useRef<(SVGGElement | null)[]>([])

  const curve = useMemo(() => Array.from({ length: SAMPLES + 1 }, (_, i) => point((i / SAMPLES) * TAU)), [])
  const d = useMemo(() => curve.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), [curve])
  const stageAt = useMemo(() => STAGES.map((_, i) => {
    const t = ((i + 0.35) / STAGES.length) * TAU
    const p = point(t)
    const dx = p.x - CX, dy = p.y - CY, len = Math.hypot(dx, dy) || 1
    return { t, ...p, lx: (dx / len) * 34, ly: (dy / len) * 30 + 4, anchor: dx > 40 ? 'start' : dx < -40 ? 'end' : 'middle' }
  }), [])

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const COUNT = 5
    const speed = 0.0000115                        // loops per ms: about 87 s per lap
    let raf = 0
    let last = performance.now()
    const u = Array.from({ length: COUNT }, (_, i) => i / COUNT)
    const par = { x: 0, y: 0, tx: 0, ty: 0 }
    const place = () => {
      const lit = new Set<number>()
      u.forEach((p, i) => {
        const idx = Math.floor(p * SAMPLES) % SAMPLES
        const c = curve[idx]
        if (!c) return
        parts.current[i]?.setAttribute('transform', `translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})`)
        const trail: string[] = []
        for (let k = 0; k < 34; k += 2) {
          const q = curve[(idx - k * 2 + SAMPLES * 2) % SAMPLES]
          trail.push(`${k ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`)
        }
        trails.current[i]?.setAttribute('d', trail.join(' '))
        stageAt.forEach((s, n) => {
          const dt = Math.abs(((p - s.t / TAU + 1.5) % 1) - 0.5)
          if (dt < 0.028) lit.add(n)
        })
      })
      nodes.current.forEach((g, n) => g?.setAttribute('data-on', lit.has(n) ? '1' : '0'))
    }
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(64, now - last)
      last = now
      for (let i = 0; i < COUNT; i++) u[i] = (u[i] + dt * speed * (1 + 0.18 * Math.sin(now / 2600 + i * 1.7))) % 1
      par.x += (par.tx - par.x) * 0.06
      par.y += (par.ty - par.y) * 0.06
      layer.current?.setAttribute('transform', `translate(${(par.x * 16).toFixed(1)} ${(par.y * 12).toFixed(1)})`)
      rings.current?.setAttribute('transform', `translate(${(-par.x * 10).toFixed(1)} ${(-par.y * 8).toFixed(1)})`)
      place()
    }
    const move = (e: PointerEvent) => { par.tx = (e.clientX / window.innerWidth - 0.5) * 2; par.ty = (e.clientY / window.innerHeight - 0.5) * 2 }
    place()
    if (!reduced) {
      window.addEventListener('pointermove', move, { passive: true })
      raf = requestAnimationFrame(frame)
    }
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', move) }
  }, [curve, stageAt])

  return (
    <svg aria-hidden viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}>
      <defs>
        <radialGradient id="wo-glow"><stop offset="0" stopColor="var(--signal)" stopOpacity="0.55" /><stop offset="1" stopColor="var(--signal)" stopOpacity="0" /></radialGradient>
        <linearGradient id="wo-trail" x1="0" x2="1"><stop offset="0" stopColor="var(--signal)" stopOpacity="0" /><stop offset="1" stopColor="var(--signal)" stopOpacity="0.9" /></linearGradient>
      </defs>

      <g ref={rings} opacity="0.55">
        {[330, 470, 620].map((r, i) => (
          <ellipse key={r} cx={CX} cy={CY} rx={r} ry={r * 0.56} fill="none" stroke="var(--border)" strokeDasharray={i === 1 ? '2 9' : '1 6'} className="wo-spin" style={{ animationDuration: `${140 + i * 60}s`, animationDirection: i % 2 ? 'reverse' : 'normal' }} />
        ))}
      </g>

      <g ref={layer}>
        <path d={d} fill="none" stroke="var(--fg-3)" strokeOpacity="0.28" strokeWidth="1.4" strokeDasharray="3 7" />
        <path d={d} fill="none" stroke="var(--signal)" strokeOpacity="0.14" strokeWidth="5" strokeLinecap="round" className="wo-flow" />

        {Array.from({ length: 5 }, (_, i) => (
          <g key={i}>
            <path ref={(el) => { trails.current[i] = el }} fill="none" stroke="url(#wo-trail)" strokeWidth="2.4" strokeLinecap="round" />
            <g ref={(el) => { parts.current[i] = el }}>
              <circle r="16" fill="url(#wo-glow)" />
              <circle r="3.6" fill="var(--signal)" />
            </g>
          </g>
        ))}

        {stageAt.map((s, i) => (
          <g key={STAGES[i].label} ref={(el) => { nodes.current[i] = el }} data-on="0" transform={`translate(${s.x} ${s.y})`} className="wo-node">
            <circle r="26" fill="url(#wo-glow)" className="wo-halo" />
            <circle r="9" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" className="wo-dot" />
            <circle r="3" fill="var(--fg-3)" className="wo-core" />
            <circle r="9" fill="none" stroke="var(--signal)" strokeWidth="1.4" className="wo-ring" />
            <text x={s.lx} y={s.ly} textAnchor={s.anchor as 'start' | 'end' | 'middle'} className="wo-label" fontSize="15" fontWeight="650" fontFamily="Bricolage Grotesque Variable, sans-serif" fill="var(--fg)">
              <tspan>{`${String(i + 1).padStart(2, '0')}  ${STAGES[i].label}`}</tspan>
              <tspan x={s.lx} dy="17" className="wo-note" fontSize="11" fontWeight="400" fontFamily="Geist Mono Variable, monospace" fill="var(--fg-3)">{STAGES[i].note}</tspan>
            </text>
          </g>
        ))}
      </g>
    </svg>
  )
}
