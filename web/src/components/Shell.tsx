import { useQuery } from '@tanstack/react-query'
import { BookMarked, FlaskConical, Network, Headset, LayoutDashboard, Library, ListChecks, Moon, ScrollText, SlidersHorizontal, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChatDock } from '@/components/ChatDock'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { CommandPalette } from '@/components/CommandPalette'
import { NotificationBell } from '@/components/NotificationBell'
import { setUiLanguage } from '@/i18n'
import { api, ApiError } from '@/lib/api'
import { useAuthActions, useMe, useSavePrefs } from '@/lib/auth'
import { PageTransition, useSmoothScroll } from '@/lib/motion'
import { useTheme } from '@/lib/theme'
import type { Role } from '@/lib/types'
import { type Health, LANGUAGES } from '@/lib/types2'

const ROLES: Role[] = ['INVESTIGATOR', 'SUPERVISOR', 'GOVERNANCE', 'AUDITOR']

const NAV = [
  { to: '/', key: 'nav.dashboard', icon: LayoutDashboard, end: true },
  { to: '/queue', key: 'nav.queue', icon: ListChecks, end: false },
  { to: '/investigate', key: 'nav.investigate', icon: Network, end: false },
  { to: '/lab', key: 'nav.lab', icon: FlaskConical, end: false },
  { to: '/precedents', key: 'nav.precedents', icon: BookMarked, end: false },
  { to: '/governance', key: 'nav.governance', icon: SlidersHorizontal, end: false },
  { to: '/audit', key: 'nav.audit', icon: ScrollText, end: false },
  { to: '/library', key: 'nav.library', icon: Library, end: false },
  { to: '/agent', key: 'nav.agent', icon: Headset, end: false },
] as const

const select = 'h-8 rounded-full border bg-transparent px-2 text-xs hover:border-primary focus-visible:border-primary'

function Mark() {
  return (
    <span aria-hidden className="lime grid h-7 w-7 grid-cols-2 place-items-center gap-[3px] rounded-[9px] p-[6px]">
      <span className="h-full w-full rounded-[2px] bg-[#0c0e0d]" />
      <span className="h-full w-full rounded-[2px] bg-[#0c0e0d]/35" />
      <span className="h-full w-full rounded-[2px] bg-[#0c0e0d]/35" />
      <span className="h-full w-full rounded-[2px] bg-[#0c0e0d]" />
    </span>
  )
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-[var(--ok)]' : 'bg-[var(--warn)]'}`} />
      {label}
    </span>
  )
}

export function Shell() {
  const { t } = useTranslation()
  const me = useMe()
  const { logout, switchRole } = useAuthActions()
  const savePrefs = useSavePrefs()
  const [switchError, setSwitchError] = useState<string | null>(null)
  const { theme, toggle } = useTheme()
  const themeBtn = useRef<HTMLButtonElement>(null)
  const loc = useLocation()
  useSmoothScroll()
  const health = useQuery<Health>({ queryKey: ['health'], queryFn: () => api('/api/health'), enabled: !!me.data, refetchInterval: 60_000, retry: false })
  const language = me.data?.language
  useEffect(() => {
    if (language) setUiLanguage(language)
  }, [language])

  if (me.isPending) return <p className="p-4">Loading…</p>
  if (!me.data) return <Navigate to="/home" replace />
  const user = me.data
  if (!user.onboarded && !user.onboardingSkipped) return <Navigate to="/welcome" replace />

  async function change(role: string) {
    setSwitchError(null)
    try {
      await switchRole(role)
    } catch (e) {
      setSwitchError(e instanceof ApiError && e.status === 404 ? 'Role switching is disabled here.' : 'Could not switch role.')
    }
  }

  const nav = NAV.filter((n) => n.to !== '/agent' || user.role !== 'AUDITOR')
  const here = nav.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))
  const crumb = loc.pathname.startsWith('/cases/') ? loc.pathname.split('/')[2] : here ? t(here.key) : ''

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-background focus:p-2">{t('app.skip')}</a>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1 border-r bg-sidebar p-4 text-sidebar-foreground lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-1">
          <Mark />
          <span className="font-heading text-[0.95rem] font-semibold tracking-tight">{t('app.name')}</span>
        </div>
        <p className="eyebrow mb-2 px-2">Workspace</p>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {nav.map(({ to, key, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `group relative flex items-center gap-2.5 rounded-full px-3 py-2 text-sm ${isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'}`
              }
            >
              {({ isActive }) => (
                <>
                  <span aria-hidden className={`absolute left-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[var(--signal)] transition-opacity ${isActive ? 'opacity-100' : 'opacity-0'}`} />
                  <Icon aria-hidden className="h-4 w-4" />
                  {t(key)}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3 px-2 text-[11px] text-muted-foreground">
          {health.data && (
            <p className="mono flex flex-wrap gap-x-3 gap-y-1">
              <Dot ok={health.data.engine === 'UP'} label="engine" />
              <Dot ok={health.data.llm === 'LIVE' || health.data.llm === 'TEMPLATE'} label={`ai ${health.data.llm.toLowerCase()}`} />
              <Dot ok={health.data.voice === 'ON'} label="voice" />
            </p>
          )}
          <p>{t('app.banner')}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex flex-wrap items-center gap-3 border-x-0 border-t-0 px-4 py-2">
          <strong className="font-heading flex items-center gap-2 lg:hidden"><Mark />{t('app.name')}</strong>
          <p className="eyebrow hidden lg:block">{t('app.name')} <span aria-hidden className="mx-1.5 opacity-50">/</span> <span className="text-foreground">{crumb}</span></p>
          <span className="ml-auto text-sm">
            {user.displayName} ({user.role})
          </span>
          <label className="text-sm">
            <span className="sr-only">Demo: act as role</span>
            <select aria-label="Demo: act as role" className={select} value={user.role} onChange={(e) => void change(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="sr-only">{t('nav.language')}</span>
            <select aria-label={t('nav.language')} className={select} value={user.language} onChange={(e) => void savePrefs({ language: e.target.value })}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.native}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))} className="hidden h-8 items-center gap-2 rounded-full border px-3 text-xs text-muted-foreground hover:border-primary md:inline-flex" aria-label="Search">
            Search <kbd className="mono text-[0.65rem]">Ctrl K</kbd>
          </button>
          <NotificationBell />
          <button
            ref={themeBtn}
            type="button"
            aria-label={t('nav.theme')}
            aria-pressed={theme === 'dark'}
            onClick={() => toggle(themeBtn.current)}
            className="grid h-8 w-8 place-items-center rounded-full border hover:border-primary"
          >
            {theme === 'dark' ? <Sun aria-hidden className="h-4 w-4" /> : <Moon aria-hidden className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => void logout()} className="h-8 rounded-full border px-3 text-xs hover:border-primary">
            {t('nav.signOut')}
          </button>
          <nav aria-label="Main (compact)" className="flex w-full gap-4 overflow-x-auto pb-1 text-sm lg:hidden">
            {nav.map(({ to, key }) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `whitespace-nowrap ${isActive ? 'font-semibold text-foreground underline underline-offset-4' : 'text-muted-foreground'}`}>
                {t(key)}
              </NavLink>
            ))}
          </nav>
        </header>
        {switchError && <p role="alert" className="px-4 pt-2 text-sm text-destructive">{switchError}</p>}
        {health.data?.engine === 'DOWN' && (
          <p role="status" className="bg-muted px-4 py-2 text-sm">
            The analysis engine is unavailable. Stored results are shown; re-runs and rule simulations are paused until it returns.
          </p>
        )}
        <p className="px-4 pt-2 text-xs text-muted-foreground lg:hidden">{t('app.banner')}</p>
        <main id="main" className="mx-auto w-full max-w-[1500px] flex-1 space-y-4 p-4 pb-24 md:px-8">
          <PageTransition routeKey={loc.pathname}>
            <Outlet />
          </PageTransition>
        </main>
      </div>
      <ErrorBoundary quiet><ChatDock /></ErrorBoundary>
      <CommandPalette onToggleTheme={() => toggle(themeBtn.current)} showAgent={user.role !== 'AUDITOR'} />
    </div>
  )
}
