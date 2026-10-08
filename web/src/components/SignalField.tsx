import { useEffect, useRef } from 'react'

/**
 * A quiet dot-matrix "signal field" behind the hero. Dots swell around the pointer and drift in a slow wave.
 * It is decorative only: it draws no data and implies nothing is live. Pauses off-screen, static for reduced motion.
 */
export function SignalField({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const SP = 16
    let w = 0
    let h = 0
    let dpr = 1
    let raf = 0
    let visible = true
    let color = '120,200,255'
    const pointer = { x: -999, y: -999, tx: -999, ty: -999 }

    const readColor = () => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--field)'
      document.body.appendChild(probe)
      const m = getComputedStyle(probe).color.match(/[\d.]+/g)
      probe.remove()
      if (m && m.length >= 3) color = `${Math.round(+m[0])},${Math.round(+m[1])},${Math.round(+m[2])}`
    }
    const resize = () => {
      const r = canvas.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = r.width
      h = r.height
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const draw = (t: number) => {
      pointer.x += (pointer.tx - pointer.x) * 0.12
      pointer.y += (pointer.ty - pointer.y) * 0.12
      ctx.clearRect(0, 0, w, h)
      for (let y = SP / 2; y < h; y += SP) {
        for (let x = SP / 2; x < w; x += SP) {
          const wave = Math.sin(x * 0.012 + t * 0.0006) * Math.cos(y * 0.014 - t * 0.0005)
          const d = Math.hypot(x - pointer.x, y - pointer.y)
          const near = Math.max(0, 1 - d / 190)
          const fade = Math.min(1, x / (w * 0.55)) * (0.35 + 0.65 * (1 - y / h))
          const a = (0.16 + 0.2 * (wave * 0.5 + 0.5) + near * 0.8) * fade
          const r = 1.1 + near * 2.4 + (wave * 0.5 + 0.5) * 0.7
          ctx.fillStyle = `rgba(${color},${Math.min(a, 0.95).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(x, y, r, 0, 6.2832)
          ctx.fill()
        }
      }
    }
    const loop = (t: number) => {
      if (visible) draw(t)
      raf = requestAnimationFrame(loop)
    }
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      pointer.tx = e.clientX - r.left
      pointer.ty = e.clientY - r.top
    }
    const leave = () => {
      pointer.tx = -999
      pointer.ty = -999
    }

    readColor()
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting }, { threshold: 0 })
    io.observe(canvas)
    const mo = new MutationObserver(readColor)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerleave', leave)
    if (reduce) draw(0)
    else raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      mo.disconnect()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerleave', leave)
    }
  }, [])

  return <canvas ref={ref} aria-hidden className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} />
}
