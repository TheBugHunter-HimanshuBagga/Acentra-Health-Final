import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { type ReactNode, useEffect, useRef } from 'react'

gsap.registerPlugin(useGSAP, ScrollTrigger)

const inJsdom = typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const still = () => inJsdom || reduced()

let lenisInstance: Lenis | null = null

/** Smooth scrolling for the whole app, driven by GSAP's ticker so ScrollTrigger stays in sync. Off for reduced motion and tests. */
export function useSmoothScroll() {
  useEffect(() => {
    if (still()) return
    let tick: ((t: number) => void) | null = null
    try {
      const lenis = new Lenis({ duration: 1.1, smoothWheel: true, easing: (t) => 1 - Math.pow(1 - t, 3) })
      lenisInstance = lenis
      lenis.on('scroll', ScrollTrigger.update)
      tick = (t: number) => lenis.raf(t * 1000)
      gsap.ticker.add(tick)
      gsap.ticker.lagSmoothing(0)
    } catch {
      lenisInstance = null
    }
    return () => {
      if (tick) gsap.ticker.remove(tick)
      lenisInstance?.destroy()
      lenisInstance = null
    }
  }, [])
}

/** Scrolls to an element with Lenis easing when it is running, natively otherwise. */
export function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  if (lenisInstance) lenisInstance.scrollTo(el, { offset: -72, duration: 1.2 })
  else el.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

/** Fades and lifts the direct children in sequence when the block first appears. */
export function Reveal({ children, className, deps = '' }: { children: ReactNode; className?: string; deps?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      if (still() || !ref.current) return
      gsap.from(ref.current.children, { opacity: 0, y: 22, scale: 0.97, duration: 0.7, stagger: 0.07, ease: 'power3.out', clearProps: 'all' })
    },
    { scope: ref, dependencies: [deps] },
  )
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}

/** Reveals the block when it scrolls into view (ScrollTrigger). Content is never hidden for reduced motion or tests. */
export function ScrollReveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      const el = ref.current
      if (still() || !el) return
      gsap.from(el, {
        opacity: 0,
        y: 36,
        duration: 0.85,
        delay,
        ease: 'power3.out',
        clearProps: 'all',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      })
    },
    { scope: ref },
  )
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}

/** A bar whose fill grows from zero when it appears. `value` is 0..1. */
export function AnimatedBar({ value, className = 'bg-primary' }: { value: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const pct = Math.max(0, Math.min(1, value)) * 100
  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      if (still()) {
        el.style.width = `${pct}%`
        return
      }
      gsap.fromTo(el, { width: '0%' }, { width: `${pct}%`, duration: 1.1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 95%', once: true } })
    },
    { dependencies: [pct] },
  )
  return <div ref={ref} className={`h-full rounded ${className}`} style={{ width: still() ? `${pct}%` : 0 }} />
}

/** Counts a number up from zero once; shows the final value immediately when motion is off. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      if (still()) {
        el.textContent = format(value)
        return
      }
      const o = { v: 0 }
      gsap.to(o, { v: value, duration: 1.2, ease: 'power3.out', onUpdate: () => { el.textContent = format(o.v) } })
    },
    { dependencies: [value] },
  )
  return <span ref={ref} className="num">{format(value)}</span>
}

/** Slow floating colour blobs behind a hero. Purely decorative. */
export function Aurora({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      if (still() || !ref.current) return
      ref.current.querySelectorAll<HTMLElement>('[data-blob]').forEach((b, i) => {
        gsap.to(b, { x: gsap.utils.random(-120, 120), y: gsap.utils.random(-80, 80), scale: gsap.utils.random(0.85, 1.25), duration: 9 + i * 2, repeat: -1, yoyo: true, ease: 'sine.inOut' })
      })
    },
    { scope: ref },
  )
  return (
    <div ref={ref} aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <div data-blob className="absolute -left-24 -top-24 h-[28rem] w-[28rem] rounded-full bg-indigo-500/35 blur-3xl" />
      <div data-blob className="absolute -right-24 top-1/3 h-[26rem] w-[26rem] rounded-full bg-teal-400/25 blur-3xl" />
      <div data-blob className="absolute -bottom-32 left-1/3 h-[30rem] w-[30rem] rounded-full bg-fuchsia-500/20 blur-3xl" />
    </div>
  )
}

/** Fades the page in whenever `routeKey` changes. */
export function PageTransition({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      if (still() || !ref.current) return
      gsap.fromTo(ref.current, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out', clearProps: 'all' })
      ScrollTrigger.refresh()
    },
    { scope: ref, dependencies: [routeKey] },
  )
  return <div ref={ref}>{children}</div>
}

/** Lifts a card toward the pointer a few pixels; a subtle premium hover. */
export function useTilt<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || still()) return
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width - 0.5
      const y = (e.clientY - r.top) / r.height - 0.5
      gsap.to(el, { rotateY: x * 6, rotateX: -y * 6, y: -3, duration: 0.4, ease: 'power2.out', transformPerspective: 700 })
    }
    const leave = () => gsap.to(el, { rotateY: 0, rotateX: 0, y: 0, duration: 0.6, ease: 'power3.out' })
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  }, [])
  return ref
}
