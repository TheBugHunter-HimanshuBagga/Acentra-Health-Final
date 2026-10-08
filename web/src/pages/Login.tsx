import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { useAuthActions } from '@/lib/auth'

export function LoginPage() {
  const { login } = useAuthActions()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    <main className="mx-auto mt-24 max-w-sm space-y-4 p-4">
      <h1 className="text-2xl font-semibold">ClaimShield Nexus</h1>
      <p className="text-sm text-muted-foreground">
        Sign in to review cases. All data in this system is synthetic.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="username">Username</Label>
          <Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !username || !password}>
          Sign in
        </Button>
      </form>
    </main>
  )
}
