import { useGSAP } from '@gsap/react'
import { useQuery } from '@tanstack/react-query'
import gsap from 'gsap'
import { ArrowRight } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Flow, type FlowStep } from '@/components/Flow'
import { ProvLegend } from '@/components/Provenance'
import { SignalField } from '@/components/SignalField'
import { money, TierBadge } from '@/components/TierBadge'
import { api } from '@/lib/api'
import { AnimatedBar, CountUp, ScrollReveal } from '@/lib/motion'
import type { QueueResponse } from '@/lib/types'
import type { Compounding, Dashboard, EvalReport, Funnel, Growth } from '@/lib/types2'

const int = (n: number) => Math.round(n).toLocaleString('en-US')
const usd0 = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const inJsdom = typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')

function Stat({ label, children, sub }: { label: string; children: React.ReactNode; sub?: string }) {
  return (
    <div className="space-y-2 py-1">
      <p className="eyebrow">{label}</p>
      <p className="bignum text-4xl md:text-5xl">{children}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Hero({ d, funnel, comp, queue }: { d: Dashboard; funnel?: Funnel; comp?: Compounding; queue?: QueueResponse }) {
  const { t } = useTranslation()
  const root = useRef<HTMLElement>(null)
  const stage = (k: string) => funnel?.stages.find((s) => s.key === k)?.count
  const decided = queue?.items.filter((i) => i.status !== 'NEW').length
  const steps: FlowStep[] = [
    { key: 'claims', label: t('pipe.claims'), sub: t('pipe.claimsSub') },
    { key: 'signals', label: t('pipe.signals'), value: stage('alerts') ?? d.kpis.alerts, sub: t('pipe.signalsSub') },
    { key: 'corr', label: t('pipe.corroboration'), value: stage('active'), sub: t('pipe.corroborationSub') },
    { key: 'evidence', label: t('pipe.evidence'), value: d.kpis.cases, sub: t('pipe.evidenceSub') },
    { key: 'case', label: t('pipe.case'), value: stage('inCapacity') ?? d.kpis.cases, sub: t('pipe.caseSub') },
    { key: 'decision', label: t('pipe.decision'), value: decided ?? null, sub: t('pipe.decisionSub'), tone: 'human' },
    { key: 'brain', label: t('pipe.brain'), value: comp ? comp.current.seedPrecedents + comp.current.livePrecedents : null, sub: t('pipe.brainSub'), tone: 'brain' },
  ]
  const top = d.needsYouNow[0]

  useGSAP(
    () => {
      if (inJsdom || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
      const tl = gsap.timeline({ defaults: { ease: 'power4.out' } })
      tl.from('[data-line] > span', { yPercent: 115, duration: 1, stagger: 0.12 }).from('[data-fade]', { opacity: 0, y: 18, duration: 0.7, stagger: 0.08 }, '-=0.6')
      gsap.to('[data-parallax]', { yPercent: -14, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: true } })
    },
    { scope: root, dependencies: [d.runId] },
  )

  const ticker = [
    `${d.runId} · ${d.kpis.alerts} alerts → ${d.kpis.cases} cases`,
    ...d.needsYouNow.map((c) => `${c.caseId} · ${c.tier} · ${usd0(c.dollars)} · ${c.hypotheses.join('/')}`),
    `${d.compounding.casesWithPrecedent} of ${d.compounding.casesTotal} cases have a similar precedent`,
    `${d.compounding.alertsSuppressed} alerts removed by ${d.compounding.activeExceptions} approved exception${d.compounding.activeExceptions === 1 ? '' : 's'}`,
  ]
  const rows = t('hero.title')
    .split(' ')
    .reduce<string[][]>((acc, w) => {
      const last = acc[acc.length - 1]
      if (last && last.join(' ').length + w.length < 14) last.push(w)
      else acc.push([w])
      return acc
    }, [])

  return (
    <section ref={root} className="relative -mx-4 -mt-4 overflow-hidden border-b md:rounded-b-3xl">
      <div className="grid-bg absolute inset-0" aria-hidden />
      <div data-parallax className="absolute inset-0" aria-hidden>
        <SignalField />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" aria-hidden />
      <div className="relative mx-auto max-w-7xl space-y-10 px-4 pb-10 pt-10 md:px-8 md:pt-16">
        <div className="max-w-3xl space-y-6">
          <p data-fade className="eyebrow inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1.5 backdrop-blur">
            <span className="live-dot" aria-hidden /> {t('hero.eyebrow', { run: d.runId })}
          </p>
          <h1 className="display text-[2.75rem] sm:text-6xl lg:text-7xl">
            {rows.map((row, i) => (
              <span key={i} data-line className="block overflow-hidden pb-1">
                <span className={`block ${i === rows.length - 1 ? 'serif text-[var(--fg-2)] !tracking-tight' : ''}`}>{row.join(' ')}</span>
              </span>
            ))}
          </h1>
          <p data-fade className="max-w-xl text-lg text-muted-foreground">{t('hero.subtitle')}</p>
          <div data-fade className="flex flex-wrap items-center gap-3">
            <Link to="/queue" className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:-translate-y-0.5">
              {t('hero.openQueue')} <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
            {top && (
              <Link to={`/cases/${top.caseId}`} className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-5 py-2.5 text-sm backdrop-blur hover:-translate-y-0.5 hover:border-primary">
                {t('hero.topCase')} · <span className="mono text-xs">{top.caseId}</span>
              </Link>
            )}
          </div>
        </div>

        <div data-fade className="glass rounded-2xl p-5 md:p-6">
          <p className="eyebrow mb-4">{t('hero.pipeline')}</p>
          <Flow steps={steps} label={t('hero.pipeline')} />
        </div>

        <p data-fade className="text-xs text-muted-foreground">{t('hero.note')}</p>
      </div>

      <div className="relative overflow-hidden border-t bg-background/70 py-2.5 backdrop-blur" aria-hidden>
        <div className="ticker mono text-xs text-muted-foreground">
          {[...ticker, ...ticker].map((x, i) => (
            <span key={i} className="mx-6 whitespace-nowrap">
              <span className="mr-6 text-[var(--signal)]">◆</span>
              {x}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

export function DashboardPage() {
  const { t } = useTranslation()
  const dash = useQuery<Dashboard>({ queryKey: ['dashboard'], queryFn: () => api('/api/dashboard') })
  const funnel = useQuery<Funnel>({ queryKey: ['funnel'], queryFn: () => api('/api/funnel') })
  const comp = useQuery<Compounding>({ queryKey: ['compounding'], queryFn: () => api('/api/compounding') })
  const evalQ = useQuery<EvalReport>({ queryKey: ['eval'], queryFn: () => api('/api/eval') })
  const growth = useQuery<Growth>({ queryKey: ['growth'], queryFn: () => api('/api/learning/growth'), retry: false })
  const queue = useQuery<QueueResponse>({ queryKey: ['queue', 90, 240, ''], queryFn: () => api('/api/queue?horizon=90&capacityHours=240'), retry: false })

  if (dash.isError) return <p role="alert">The dashboard could not be loaded.</p>
  if (!dash.data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-64 animate-pulse rounded-3xl bg-muted" />
        <div className="grid grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div>
      </div>
    )
  }
  const d = dash.data
  const total = d.kpis.exactDollars + d.kpis.estimatedDollars
  const used = queue.data?.usedHours
  const cap = queue.data?.capacityHours

  return (
    <div className="space-y-12">
      <Hero d={d} funnel={funnel.data} comp={comp.data} queue={queue.data} />

      <section aria-labelledby="posture-h" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">{t('dashboard.posture')}</p>
            <h2 id="posture-h" className="text-2xl font-semibold md:text-3xl">{t('dashboard.title')}</h2>
          </div>
          <p className="max-w-md text-sm text-muted-foreground">{t('dashboard.subtitle')} · run {d.runId}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-8 border-y py-8 md:grid-cols-4 [&>*:not(:first-child)]:md:border-l [&>*:not(:first-child)]:md:pl-8">
          <Stat label={t('dashboard.alerts')} sub={`${d.kpis.cases} ${t('dashboard.cases').toLowerCase()}`}>
            <CountUp value={d.kpis.alerts} format={int} />
          </Stat>
          <Stat label={t('dashboard.highRisk')} sub={`${d.kpis.medium} ${t('dashboard.medium').toLowerCase()} · ${d.kpis.monitor} ${t('dashboard.monitor').toLowerCase()}`}>
            <span className="tier-high"><CountUp value={d.kpis.high} format={int} /></span>
          </Stat>
          <Stat label={t('dashboard.exposure')} sub={`${usd0(d.kpis.exactDollars)} ${t('dashboard.exactDollars').toLowerCase()} · ${usd0(d.kpis.estimatedDollars)} ${t('dashboard.estimatedDollars').toLowerCase()}`}>
            <CountUp value={total} format={usd0} />
          </Stat>
          <Stat label={t('dashboard.capacity')} sub={used != null && cap != null ? t('dashboard.hours', { used: used.toFixed(0), total: cap.toFixed(0) }) : undefined}>
            {used != null && cap ? <CountUp value={(used / cap) * 100} format={(n) => `${Math.round(n)}%`} /> : <span className="text-muted-foreground">—</span>}
          </Stat>
        </div>
        {used != null && cap ? (
          <div className="h-1 rounded bg-muted" role="presentation"><AnimatedBar value={used / cap} className="bg-[var(--signal)]" /></div>
        ) : null}
        <ProvLegend />
      </section>

      <div className="grid gap-10 lg:grid-cols-5">
        <ScrollReveal className="lg:col-span-3">
          <section className="space-y-4" aria-labelledby="funnel-h">
            <div className="flex items-baseline justify-between"><h2 id="funnel-h" className="text-lg font-semibold">{t('dashboard.funnel')}</h2><span className="eyebrow">{t('dashboard.alerts')} → {t('dashboard.cases')}</span></div>
            {funnel.data ? (
              <>
                <div className="h-56" role="img" aria-label={funnel.data.stages.map((s) => `${s.label}: ${s.count}`).join(', ')}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={funnel.data.stages} layout="vertical" margin={{ left: 8, right: 24 }}>
                      <defs>
                        <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" style={{ stopColor: 'var(--chart-1)', stopOpacity: 0.35 }} />
                          <stop offset="100%" style={{ stopColor: 'var(--chart-1)' }} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid horizontal={false} strokeOpacity={0.25} />
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.4 }} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="count" radius={[0, 6, 6, 0]} fill="url(#barGrad)" animationDuration={1400} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <ul className="flex flex-wrap gap-x-5 text-sm">
                  {funnel.data.stages.map((s) => (
                    <li key={s.key}><span className="text-muted-foreground">{s.label}</span> <strong className="num">{s.count}</strong></li>
                  ))}
                </ul>
                {Object.keys(funnel.data.suppressedByException).length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Approved exceptions removed{' '}
                    {Object.entries(funnel.data.suppressedByException).map(([k, v]) => `${v} alerts (${k})`).join(', ')}.
                  </p>
                )}
                {funnel.data.coverage && (
                  <p className="text-sm text-muted-foreground">
                    On the synthetic ground truth, the cases inside capacity cover {(funnel.data.coverage.pct * 100).toFixed(0)}% of the injected
                    dollars ({usd0(funnel.data.coverage.dollarsInCapacityCases)} of {usd0(funnel.data.coverage.positiveDollars)}).
                  </p>
                )}
              </>
            ) : (
              <div className="h-56 animate-pulse rounded-lg bg-muted" />
            )}
          </section>
        </ScrollReveal>

        <ScrollReveal delay={0.08} className="lg:col-span-2">
          <section className="space-y-3" aria-labelledby="needs-h">
            <div className="flex items-baseline justify-between"><h2 id="needs-h" className="text-lg font-semibold">{t('dashboard.needsYou')}</h2><Link className="eyebrow hover:text-foreground" to="/queue">Open the full queue →</Link></div>
            {d.needsYouNow.length === 0 && <p className="text-sm">{t('dashboard.empty')}</p>}
            <ul className="divide-y border-y">
              {d.needsYouNow.map((c, i) => (
                <li key={c.caseId} className="row-hover group flex items-center gap-3 py-3">
                  <span className="mono w-5 text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                  <TierBadge tier={c.tier} />
                  <div className="min-w-0 flex-1">
                    <Link className="font-medium underline-offset-4 hover:underline" to={`/cases/${c.caseId}`}>{c.caseId}</Link>
                    <p className="truncate text-xs text-muted-foreground">{c.primary} · {c.hypotheses.join(', ')}</p>
                  </div>
                  <span className="num text-sm">{money(c.dollars)}</span>
                  <ArrowRight aria-hidden className="h-4 w-4 -translate-x-1 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" />
                </li>
              ))}
            </ul>
          </section>
        </ScrollReveal>
      </div>

      <div className="grid gap-10 lg:grid-cols-5">
        <ScrollReveal className="lg:col-span-2">
          <section className="space-y-4" aria-labelledby="exp-h">
            <h2 id="exp-h" className="text-lg font-semibold">Dollars by scheme</h2>
            <div className="h-64" role="img" aria-label="Dollars by scheme">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.exposureByScheme} margin={{ left: 4, right: 8 }}>
                  <defs>
                    <linearGradient id="barGradV" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" style={{ stopColor: 'var(--chart-1)' }} />
                      <stop offset="100%" style={{ stopColor: 'var(--chart-1)', stopOpacity: 0.25 }} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeOpacity={0.25} />
                  <XAxis dataKey="scheme" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} width={46} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.4 }} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={(v) => usd0(Number(v))} labelFormatter={(l) => d.exposureByScheme.find((s) => s.scheme === l)?.label ?? l} />
                  <Bar dataKey="dollars" radius={[6, 6, 0, 0]} animationDuration={1400}>
                    {d.exposureByScheme.map((s) => <Cell key={s.scheme} fill="url(#barGradV)" />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </ScrollReveal>

        <ScrollReveal delay={0.08} className="lg:col-span-3">
          <section className="space-y-4" aria-labelledby="comp-h">
            <h2 id="comp-h" className="text-lg font-semibold">{t('dashboard.compounding')}</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y py-5 sm:grid-cols-4">
              <div><dt className="eyebrow">Seed precedents</dt><dd className="bignum mt-1 text-3xl">{d.compounding.seedPrecedents}</dd></div>
              <div><dt className="eyebrow">Precedents added by reviewers</dt><dd className="bignum mt-1 text-3xl">{d.compounding.livePrecedents}</dd></div>
              <div><dt className="eyebrow">Approved exceptions</dt><dd className="bignum mt-1 text-3xl">{d.compounding.activeExceptions}</dd></div>
              <div><dt className="eyebrow">Alerts removed by exceptions</dt><dd className="bignum mt-1 text-3xl">{d.compounding.alertsSuppressed}</dd></div>
            </dl>
            <p className="text-sm">
              {d.compounding.casesWithPrecedent} of {d.compounding.casesTotal} cases have a similar precedent.
              {d.compounding.tierChangedByPrecedent.length > 0 &&
                ` Precedents changed the tier of ${d.compounding.tierChangedByPrecedent.map((c) => `${c.caseId} (${c.without} to ${c.with})`).join(', ')}.`}
            </p>
            {comp.data && comp.data.runs.length > 1 && (
              <ol className="space-y-1 text-sm" aria-label="Run history">
                {comp.data.runs.slice(0, 5).map((r) => (
                  <li key={r.runId}>
                    <span className="mono text-xs">{r.runId}</span> · {r.stages.map((s) => `${s.label} ${s.count}`).join(' → ')}
                    {r.diffFrom ? ` (changes since ${r.diffFrom})` : ''}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </ScrollReveal>
      </div>

      {d.distributions && (
        <ScrollReveal>
          <section className="grid gap-10 lg:grid-cols-3" aria-labelledby="dist-h">
            <div className="space-y-3">
              <h2 id="dist-h" className="text-lg font-semibold">Confidence distribution</h2>
              <ul className="space-y-2" aria-label="Cases by confidence level">
                {(['HIGH', 'MEDIUM', 'LOW'] as const).map((k) => {
                  const total = Object.values(d.distributions!.confidence).reduce((a, b) => a + b, 0) || 1
                  return (
                    <li key={k} className="text-sm">
                      <div className="flex justify-between"><span>{k === 'LOW' ? 'LOW (monitor list)' : k}</span><span className="num">{d.distributions!.confidence[k]}</span></div>
                      <div className="h-1.5 rounded bg-muted"><AnimatedBar value={d.distributions!.confidence[k] / total} className={k === 'HIGH' ? 'bg-[var(--tier-high)]' : k === 'MEDIUM' ? 'bg-[var(--tier-medium)]' : 'bg-[var(--tier-monitor)]'} /></div>
                    </li>
                  )
                })}
              </ul>
              <p className="text-xs text-muted-foreground">Confidence is the strength and agreement of evidence, not the risk score.</p>
            </div>
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Evidence strength</h2>
              <div className="h-40" role="img" aria-label={d.distributions.evidenceStrength.map((b) => `${b.bucket}: ${b.cases}`).join(', ')}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.distributions.evidenceStrength} margin={{ left: -20, right: 4 }}>
                    <CartesianGrid vertical={false} strokeOpacity={0.25} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.4 }} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="cases" fill="var(--chart-1)" radius={[4, 4, 0, 0]} animationDuration={1200} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted-foreground">Independent channels agreeing: {d.distributions.channelsAgreeing.map((c) => `${c.channels} channel${c.channels === 1 ? '' : 's'}: ${c.cases} cases`).join(' · ')}</p>
            </div>
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Trends and networks</h2>
              <p className="text-sm">{Object.entries(d.trends ?? {}).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ') || 'No trend data'}</p>
              {d.networks && d.networks.length > 0 ? (
                <ul className="divide-y border-y text-sm" aria-label="Emerging networks">
                  {d.networks.map((n) => (
                    <li key={n.caseId} className="flex items-center gap-2 py-2"><Link className="font-medium underline-offset-4 hover:underline" to={`/cases/${n.caseId}`}>{n.caseId}</Link><span className="text-xs text-muted-foreground">{n.providers} providers · {n.rules.join(', ')}</span><span className="num ml-auto">{money(n.dollars)}</span></li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">No relationship-based case in this run.</p>}
              {d.outlook?.available && (
                <p className="text-xs text-muted-foreground"><span className="chip chip-pred mr-2">prediction</span>Mean outlook across cases: {(['30', '60', '90'] as const).map((h) => `${h}d ${d.outlook!.mean[h] != null ? Math.round((d.outlook!.mean[h] as number) * 100) + '%' : '—'}`).join(' · ')}. {d.outlook.label}.</p>
              )}
            </div>
          </section>
        </ScrollReveal>
      )}

      {growth.data && (
        <ScrollReveal>
          <section className="grid gap-10 lg:grid-cols-5" aria-labelledby="learn-h">
            <div className="space-y-3 lg:col-span-2">
              <h2 id="learn-h" className="text-lg font-semibold">Institutional knowledge</h2>
              <dl className="grid grid-cols-2 gap-4 border-y py-4">
                <div><dt className="eyebrow">Approved lessons</dt><dd className="bignum text-3xl">{growth.data.approvedKnowledge}</dd></div>
                <div><dt className="eyebrow">Waiting for review</dt><dd className="bignum text-3xl">{growth.data.pendingKnowledge}</dd></div>
                <div><dt className="eyebrow">Reviewer precedents</dt><dd className="bignum text-3xl">{growth.data.livePrecedents}</dd></div>
                <div><dt className="eyebrow">Feedback items</dt><dd className="bignum text-3xl">{growth.data.feedback}</dd></div>
              </dl>
              {growth.data.byDay.length > 0 && (
                <div className="h-24" role="img" aria-label="Knowledge drafted per day">
                  <ResponsiveContainer width="100%" height="100%"><BarChart data={growth.data.byDay} margin={{ left: -30 }}><XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} /><Bar dataKey="n" fill="var(--chart-2)" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
                </div>
              )}
            </div>
            <div className="space-y-3 lg:col-span-3">
              <h2 className="text-lg font-semibold">Recent decisions</h2>
              {growth.data.recentDecisions.length === 0 ? <p className="text-sm text-muted-foreground">No decision has been recorded yet.</p> : (
                <ul className="divide-y border-y text-sm">
                  {growth.data.recentDecisions.map((r, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 py-2"><Link className="font-medium underline-offset-4 hover:underline" to={`/cases/${r.case_id}`}>{r.case_id}</Link><span>{r.actor}</span><span className="chip chip-human">{r.action.toLowerCase()}</span><span className="eyebrow">{r.status.replace('_', ' ').toLowerCase()}</span><span className="mono ml-auto text-xs text-muted-foreground">{r.created_at.slice(0, 16).replace('T', ' ')}</span></li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </ScrollReveal>
      )}

      {evalQ.data && (
        <ScrollReveal>
          <section className="space-y-3 border-t pt-8" aria-labelledby="eval-h">
            <p className="eyebrow">Synthetic ground truth</p>
            <h2 id="eval-h" className="text-lg font-semibold">How we know it works</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>
                Network ring recovered: <strong>{evalQ.data.network.ringRecovered ? 'yes' : 'no'}</strong>; decoys falsely flagged:{' '}
                <strong>{evalQ.data.decoys.falselyFlagged}</strong> of {evalQ.data.decoys.lines} decoy lines.
              </li>
              <li>
                Temporal detector caught {evalQ.data.temporal.detected} of {evalQ.data.temporal.schemeProviders} scheme providers, median delay{' '}
                {evalQ.data.temporal.medianDelayMonths} month(s).
              </li>
              {evalQ.data.prediction.available && (
                <li>
                  30/60/90-day outlook model: {evalQ.data.prediction.model}, evaluated on held-out providers and later months (see the workspace
                  outlook for each case).
                </li>
              )}
            </ul>
            {evalQ.data.notes.map((n) => (
              <p key={n} className="text-xs text-muted-foreground">{n}</p>
            ))}
          </section>
        </ScrollReveal>
      )}
    </div>
  )
}
