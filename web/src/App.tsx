import { useState } from 'react'
import { Link, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { useAuthActions, useMe } from '@/lib/auth'
import type { Role } from '@/lib/types'
import { AuditPage } from '@/pages/Audit'
import { CasePage } from '@/pages/Case'
import { LoginPage } from '@/pages/Login'
import { QueuePage } from '@/pages/Queue'

const ROLES: Role[] = ['INVESTIGATOR', 'SUPERVISOR', 'GOVERNANCE', 'AUDITOR']

function Shell() {
  const me = useMe()
  const { logout, switchRole } = useAuthActions()
  const [switchError, setSwitchError] = useState<string | null>(null)

  if (me.isPending) return <p className="p-4">Loading…</p>
  if (!me.data) return <Navigate to="/login" replace />
  const user = me.data

  async function change(role: string) {
    setSwitchError(null)
    try {
      await switchRole(role)
    } catch (e) {
      setSwitchError(e instanceof ApiError && e.status === 404 ? 'Role switching is disabled here.' : 'Could not switch role.')
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-4 border-b pb-3">
        <strong>ClaimShield Nexus</strong>
        <nav aria-label="Main" className="flex gap-3">
          <Link className="underline" to="/">Queue</Link>
          <Link className="underline" to="/audit">Audit</Link>
        </nav>
        <span className="ml-auto text-sm">
          {user.displayName} ({user.role})
        </span>
        <label className="text-sm">
          <span className="sr-only">Demo: act as role</span>
          <select
            aria-label="Demo: act as role"
            className="h-8 rounded-md border px-2"
            value={user.role}
            onChange={(e) => void change(e.target.value)}
          >
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <Button variant="outline" size="sm" onClick={() => void logout()}>
          Sign out
        </Button>
      </header>
      {switchError && <p role="alert" className="text-sm text-destructive">{switchError}</p>}
      <p className="text-xs text-muted-foreground">Synthetic data only. Indicators need human review; they are not findings.</p>
      <Outlet />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Shell />}>
        <Route index element={<QueuePage />} />
        <Route path="cases/:caseId" element={<CasePage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
