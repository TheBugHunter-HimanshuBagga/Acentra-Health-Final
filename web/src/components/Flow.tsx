import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { useRef } from 'react'

export interface FlowStep {
  key: string
  label: string
  value?: string | number | null
  sub?: string
  tone?: 'default' | 'human' | 'brain'
}

const still = () =>
  (typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')) ||
  (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

/**
 * A left-to-right (top-to-bottom on phones) process line. The line draws itself, the stages arrive in sequence, and a
 * single pulse travels along it. The pulse is decoration: it does not represent live data.
 */
export function Flow({ steps, label }: { steps: FlowStep[]; label: string }) {
  const root = useRef<HTMLOListElement>(null)

  useGSAP(
    () => {
      if (still() || !root.current) return
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
      tl.from('[data-flow-line]', { scaleX: 0, transformOrigin: 'left center', duration: 1.1, ease: 'power2.inOut' })
        .from('[data-flow-step]', { opacity: 0, y: 16, duration: 0.55, stagger: 0.09 }, 0.15)
        .from('[data-flow-dot]', { scale: 0, duration: 0.4, stagger: 0.09 }, 0.2)
      gsap.fromTo('[data-flow-pulse]', { left: '0%', opacity: 0 }, { left: '100%', opacity: 1, duration: 4.5, ease: 'none', repeat: -1, repeatDelay: 1.5, keyframes: { opacity: [0, 1, 1, 0] } })
    },
    { scope: root },
  )

  return (
    <ol ref={root} aria-label={label} className="relative grid gap-5 md:grid-flow-col md:auto-cols-fr md:gap-2">
      <span aria-hidden className="absolute left-[0.45rem] top-2 hidden h-px w-[calc(100%-1rem)] md:block">
        <span data-flow-line className="block h-px w-full bg-gradient-to-r from-[var(--border)] via-[var(--signal)] to-[var(--border)] opacity-60" />
        <span data-flow-pulse className="absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-[var(--signal)] shadow-[0_0_12px_var(--signal)]" style={{ left: 0 }} />
      </span>
      <span aria-hidden className="absolute bottom-2 left-[0.45rem] top-2 w-px bg-gradient-to-b from-[var(--border)] via-[var(--signal)] to-[var(--border)] opacity-50 md:hidden" />
      {steps.map((s, i) => (
        <li key={s.key} data-flow-step className="relative flex gap-3 pl-6 md:block md:pl-0 md:pt-6">
          <span
            data-flow-dot
            aria-hidden
            className={`absolute left-0 top-1 h-[0.95rem] w-[0.95rem] rounded-full border-2 bg-background md:top-0 ${
              s.tone === 'human' ? 'border-[var(--foreground)]' : s.tone === 'brain' ? 'border-[var(--warn)]' : 'border-[var(--signal)]'
            }`}
          />
          <div className="min-w-0">
            <p className="eyebrow">{String(i + 1).padStart(2, '0')}</p>
            <p className="font-heading text-sm font-medium leading-tight">{s.label}</p>
            {s.value != null && <p className="bignum mt-1 text-2xl">{s.value}</p>}
            {s.sub && <p className="mt-0.5 text-xs text-muted-foreground">{s.sub}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}
