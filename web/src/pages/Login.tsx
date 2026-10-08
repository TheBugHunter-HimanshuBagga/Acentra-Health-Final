import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SignalField } from '@/components/SignalField'
import { WorkflowOrbit } from '@/components/WorkflowOrbit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { useAuthActions } from '@/lib/auth'

const POINTS = [
  'Independent evidence channels corroborate every case',
  'AI explains only validated evidence',
  'Two people approve every high-impact action',
  'Each decision becomes governed institutional knowledge',
]

export function LoginPage() {
  const { login } = useAuthActions()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (navigator.userAgent.includes('jsdom') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
      const tl = gsap.timeline({ defaults: { ease: 'power4.out' } })
      tl.from('[data-line] > span', { yPercent: 110, duration: 1, stagger: 0.12 })
        .from('[data-fade]', { opacity: 0, y: 18, duration: 0.7, stagger: 0.08 }, '-=0.6')
        .from('[data-point]', { opacity: 0, x: -20, duration: 0.5, stagger: 0.08 }, '-=0.5')
        .from('[data-card]', { opacity: 0, y: 28, duration: 0.8, clearProps: 'all' }, 0.3)
    },
    { scope: root },
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(username, password)
      navigate('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not sign in. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={root} className="relative grid min-h-screen overflow-hidden bg-background lg:grid-cols-[1.15fr_1fr]">
      <div className="grid-bg absolute inset-0" aria-hidden />
      <SignalField />
      <WorkflowOrbit className="opacity-80" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background via-background/70 to-transparent" aria-hidden />

      <div className="relative z-10 flex flex-col justify-center gap-8 p-8 lg:p-16">
        <p data-fade className="eyebrow inline-flex w-fit items-center gap-2 rounded-full border bg-background/60 px-3 py-1.5 backdrop-blur">
          <span className="live-dot" aria-hidden /> SIU intelligence platform
        </p>
        <h1 className="display text-5xl sm:text-6xl lg:text-7xl">
          <span data-line className="block overflow-hidden pb-1"><span className="block">ClaimShield</span></span>
          <span data-line className="block overflow-hidden pb-1"><span className="serif block text-[var(--fg-2)]">Nexus.</span></span>
        </h1>
        <p data-fade className="max-w-md text-lg text-muted-foreground">
          From thousands of unexplained alerts to a short list of cases an investigator can understand, defend and learn from.
        </p>
        <ul className="space-y-3 text-sm">
          {POINTS.map((p, i) => (
            <li key={p} data-point className="flex items-center gap-3">
              <span className="mono text-xs text-[var(--signal)]">{String(i + 1).padStart(2, '0')}</span>
              <span className="h-px w-8 bg-border" /> {p}
            </li>
          ))}
        </ul>
      </div>

      <main className="relative z-10 flex items-center justify-center p-6">
        <div data-card className="glass w-full max-w-sm space-y-5 rounded-2xl p-7 shadow-2xl">
          <div className="space-y-1">
            <p className="eyebrow">Secure access</p>
            <h2 className="text-xl font-semibold">Sign in</h2>
            <p className="text-sm text-muted-foreground">Sign in to review cases. All data in this system is synthetic.</p>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="username">Username</Label>
              <Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy || !username || !password}>
              Sign in
            </Button>
          </form>
        </div>
      </main>
    </div>
  )
}
