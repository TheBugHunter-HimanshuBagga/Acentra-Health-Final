import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { useAuthActions } from '@/lib/auth'
import { Aurora } from '@/lib/motion'

const POINTS = [
  'Independent evidence channels corroborate every case',
  'Claude explains only validated evidence',
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
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
      tl.from('[data-hero] > *', { opacity: 0, y: 40, duration: 0.9, stagger: 0.12 })
        .from('[data-point]', { opacity: 0, x: -24, duration: 0.6, stagger: 0.1 }, '-=0.4')
        .from('[data-card]', { opacity: 0, y: 30, scale: 0.97, duration: 0.8, clearProps: 'all' }, '-=1.1')
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
    <div ref={root} className="relative grid min-h-screen overflow-hidden bg-[oklch(0.17_0.04_270)] text-white lg:grid-cols-2">
      <Aurora />
      <div className="relative z-10 flex flex-col justify-center gap-6 p-8 lg:p-16">
        <div data-hero className="space-y-5">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-teal-300" /> SIU intelligence platform
          </p>
          <h1 className="bg-gradient-to-r from-white via-indigo-200 to-teal-200 bg-clip-text text-5xl font-semibold leading-tight tracking-tight text-transparent lg:text-6xl">
            ClaimShield Nexus
          </h1>
          <p className="max-w-md text-lg text-white/75">
            From thousands of unexplained alerts to a short list of cases an investigator can understand, defend and learn from.
          </p>
        </div>
        <ul className="space-y-3 text-sm text-white/80">
          {POINTS.map((p) => (
            <li key={p} data-point className="flex items-center gap-3">
              <span className="h-px w-8 bg-gradient-to-r from-teal-300 to-transparent" /> {p}
            </li>
          ))}
        </ul>
      </div>

      <main className="relative z-10 flex items-center justify-center p-6">
        <div data-card className="w-full max-w-sm space-y-5 rounded-2xl border border-white/15 bg-white/10 p-7 shadow-2xl backdrop-blur-xl">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Sign in</h2>
            <p className="text-sm text-white/70">Sign in to review cases. All data in this system is synthetic.</p>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="username">Username</Label>
              <Input id="username" autoComplete="username" className="border-white/20 bg-white/10 text-white" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                className="border-white/20 bg-white/10 text-white"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-300">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full bg-gradient-to-r from-indigo-500 to-teal-500 text-white hover:opacity-90" disabled={busy || !username || !password}>
              Sign in
            </Button>
          </form>
        </div>
      </main>
    </div>
  )
}
