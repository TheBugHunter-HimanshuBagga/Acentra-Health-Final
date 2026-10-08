// Playback for the investigation: an event timeline you can play, pause, step, scrub and jump around, with the risk
// meter that moves as evidence is discovered. Event colours repeat the motion language of the canvas.
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react'
import { KIND_LABEL, type Step, type StepKind } from './simulation'

export const KIND_COLOR: Record<StepKind, string> = {
  DISCOVERY: 'var(--chart-2)', CLAIM_ANALYSIS: 'var(--chart-2)', SUSPICIOUS: 'var(--warn)',
  RELATIONSHIP: 'var(--chart-4)', RISK: 'var(--tier-high)', SIU: 'var(--signal)',
}
export const SPEEDS = [0.5, 1, 2, 4] as const

interface Props {
  steps: Step[]
  index: number
  playing: boolean
  speed: number
  onPlay: () => void
  onPause: () => void
  onStep: (delta: number) => void
  onRestart: () => void
  onSeek: (i: number) => void
  onSpeed: (s: number) => void
}

const btn = 'grid h-8 w-8 place-items-center rounded-full border bg-background/60 transition hover:bg-muted active:scale-95 disabled:pointer-events-none disabled:opacity-40'

export function RiskMeter({ value, level }: { value: number; level?: string }) {
  const pct = Math.max(0, Math.min(1, value))
  const r = 22, c = 2 * Math.PI * r
  return (
    <div className="flex items-center gap-3" role="meter" aria-label="Risk" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(pct.toFixed(2))}>
      <svg viewBox="0 0 56 56" className="h-12 w-12 -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--border)" strokeWidth="5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--tier-high)" strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)' }} />
      </svg>
      <div className="leading-tight">
        <p className="eyebrow">Risk</p>
        <p className="figure text-2xl tabular-nums">{pct.toFixed(2)}</p>
        {level && <p className="mono text-[0.62rem] text-muted-foreground">{level}</p>}
      </div>
    </div>
  )
}

export function SimDock({ steps, index, playing, speed, onPlay, onPause, onStep, onRestart, onSeek, onSpeed }: Props) {
  const cur = steps[Math.max(0, Math.min(index, steps.length - 1))]
  const last = steps.length - 1
  return (
    <div className="rounded-2xl border bg-popover/90 p-3 shadow-xl backdrop-blur" role="group" aria-label="Investigation playback">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <button type="button" className={btn} aria-label="Restart" onClick={onRestart}><RotateCcw aria-hidden className="h-3.5 w-3.5" /></button>
          <button type="button" className={btn} aria-label="Step back" disabled={index <= 0} onClick={() => onStep(-1)}><SkipBack aria-hidden className="h-3.5 w-3.5" /></button>
          <button type="button" className={`${btn} !h-9 !w-9 bg-primary text-primary-foreground hover:bg-primary/90`} aria-label={playing ? 'Pause' : 'Play'} onClick={playing ? onPause : onPlay}>
            {playing ? <Pause aria-hidden className="h-4 w-4" /> : <Play aria-hidden className="h-4 w-4" />}
          </button>
          <button type="button" className={btn} aria-label="Step forward" disabled={index >= last} onClick={() => onStep(1)}><SkipForward aria-hidden className="h-3.5 w-3.5" /></button>
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[0.68rem]">
            <span className="mono rounded-full border px-1.5 py-0.5" style={{ color: KIND_COLOR[cur.kind], borderColor: `color-mix(in oklab, ${KIND_COLOR[cur.kind]} 45%, transparent)` }}>{KIND_LABEL[cur.kind]}</span>
            <span className="mono text-muted-foreground">step {Math.max(0, index) + 1} of {steps.length}</span>
          </p>
          <p className="truncate text-sm font-medium" aria-live="polite">{cur.title}</p>
        </div>
        <div role="radiogroup" aria-label="Playback speed" className="flex overflow-hidden rounded-full border text-[0.68rem]">
          {SPEEDS.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={speed === s} onClick={() => onSpeed(s)}
              className={`mono px-2 py-1 transition ${speed === s ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{s}×</button>
          ))}
        </div>
      </div>
      <div className="relative mt-3 h-6" >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
        <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--signal)] transition-[width] duration-500" style={{ width: `${steps.length > 1 ? (index / last) * 100 : 0}%` }} />
        {steps.map((s, i) => (
          <button key={s.id} type="button" onClick={() => onSeek(i)} aria-label={`Go to step ${i + 1}: ${s.title}`} title={`${i + 1}. ${s.title}`}
            className="absolute top-1/2 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ left: `${steps.length > 1 ? (i / last) * 100 : 0}%` }}>
            <span className="block rounded-full border-2 bg-background transition-all duration-300"
              style={{ width: i === index ? 14 : 9, height: i === index ? 14 : 9, borderColor: i <= index ? KIND_COLOR[s.kind] : 'var(--border)', background: i <= index ? KIND_COLOR[s.kind] : 'var(--background)' }} />
          </button>
        ))}
      </div>
    </div>
  )
}
