import { useGSAP } from '@gsap/react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import gsap from 'gsap'
import { ChevronRight, Search } from 'lucide-react'
import { Fragment, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { money, TierBadge } from '@/components/TierBadge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { AnimatedBar } from '@/lib/motion'
import type { QueueItem, QueueResponse } from '@/lib/types'

interface MonitorResponse {
  items: { monitorId: string; providerId: string; reasons: { caseId?: string; tierReasons?: string[] }; whatWouldRaiseConfidence: string[] }[]
}

const inJsdom = typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')
const pct = (v: number) => v.toFixed(2)

/** Four thin meters: risk, member impact, severity, evidence strength. Numbers are in the tooltip and the expanded row. */
function Meters({ f }: { f: QueueItem['factors'] }) {
  const rows: [string, number][] = [['Risk', f.risk], ['Impact', f.memberImpact], ['Severity', f.severity], ['Evidence', f.evidenceStrength]]
  return (
    <div className="grid w-28 gap-[3px]" role="img" aria-label={rows.map(([l, v]) => `${l} ${pct(v)}`).join(', ')}>
      {rows.map(([l, v]) => (
        <span key={l} className="block h-[3px] rounded bg-muted" title={`${l} ${pct(v)}`}>
          <span className="block h-full rounded bg-[var(--signal)]" style={{ width: `${Math.round(v * 100)}%`, opacity: 0.45 + v * 0.55 }} />
        </span>
      ))}
    </div>
  )
}

function Why({ i }: { i: QueueItem }) {
  const { t } = useTranslation()
  const rows: [string, number, string][] = [
    ['Risk', i.factors.risk, 'Probability-style score from rules, peers, history and network'],
    ['Dollar score', i.factors.dollarScore, 'Scaled dollars at stake (exact and estimated)'],
    ['Member impact', i.factors.memberImpact, 'How many members are touched'],
    ['Severity', i.factors.severity, 'Seriousness of the strongest pattern'],
    ['Evidence strength', i.factors.evidenceStrength, 'Strength of the corroborating evidence'],
  ]
  return (
    <div className="grid gap-6 py-4 md:grid-cols-5">
      <div className="space-y-2 md:col-span-3">
        <p className="eyebrow">{t('queue.why')}</p>
        <ul className="space-y-2">
          {rows.map(([l, v, hint]) => (
            <li key={l} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-xs">
              <span title={hint}>{l}</span>
              <span className="h-1.5 rounded bg-muted"><AnimatedBar value={v} className="bg-[var(--signal)]" /></span>
              <span className="num text-right text-muted-foreground">{pct(v)}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Utility {i.utility.toFixed(2)} = a transparent weighting of the five factors, divided by investigation effort.</p>
      </div>
      <dl className="space-y-1.5 text-xs md:col-span-2">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Subjects</dt><dd>{i.subjects.map((s) => `${s.id} (${s.role.toLowerCase()})`).join(', ')}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Patterns</dt><dd>{i.hypotheses.join(', ')}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Trend</dt><dd>{i.trend ?? '—'}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Dollars</dt><dd className="num">{money(i.dollars.exact)} exact + {money(i.dollars.estimated)} est.</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Effort</dt><dd className="num">{i.estHours.toFixed(1)} h</dd></div>
        <Link to={`/cases/${i.caseId}`} className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline">{t('queue.open')} →</Link>
      </dl>
    </div>
  )
}

export function QueuePage() {
  const { t } = useTranslation()
  const [horizon, setHorizon] = useState(90)
  const [capacity, setCapacity] = useState(240)
  const [tier, setTier] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const body = useRef<HTMLTableSectionElement>(null)
  const q = useQuery<QueueResponse>({
    queryKey: ['queue', horizon, capacity, tier],
    queryFn: () => api<QueueResponse>(`/api/queue?horizon=${horizon}&capacityHours=${capacity}${tier ? `&tier=${tier}` : ''}`),
    placeholderData: keepPreviousData,
  })
  const monitor = useQuery<MonitorResponse>({ queryKey: ['monitor'], queryFn: () => api('/api/monitor'), retry: false })

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase()
    const items = q.data?.items ?? []
    if (!s) return items
    return items.filter((i) => [i.caseId, i.status, i.tier, ...i.hypotheses, ...i.subjects.map((x) => x.id)].join(' ').toLowerCase().includes(s))
  }, [q.data, search])

  useGSAP(
    () => {
      if (inJsdom || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !body.current) return
      gsap.from(body.current.querySelectorAll('[data-row]'), { opacity: 0, y: 10, duration: 0.4, stagger: 0.025, ease: 'power2.out', clearProps: 'all' })
    },
    { dependencies: [horizon, tier, search, q.data?.runId, shown.length], scope: body },
  )

  const used = q.data?.usedHours ?? 0
  const cap = q.data?.capacityHours ?? capacity

  return (
    <section className="space-y-6">
      <header className="space-y-4">
        <div>
          <p className="eyebrow">Operations console</p>
          <h1 className="text-3xl font-semibold md:text-4xl">SIU queue</h1>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-y py-4">
          <div className="relative min-w-[14rem] flex-1">
            <Label htmlFor="qsearch" className="sr-only">{t('queue.search')}</Label>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="qsearch" placeholder={t('queue.search')} className="h-9 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="horizon" className="eyebrow">Risk horizon</Label>
            <select id="horizon" className="block h-9 rounded-md border bg-transparent px-2 text-sm" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
              {[30, 60, 90].map((h) => (
                <option key={h} value={h}>{`${h} days`}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tier" className="eyebrow">Confidence</Label>
            <select id="tier" className="block h-9 rounded-md border bg-transparent px-2 text-sm" value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="">All</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="capacity" className="eyebrow">Investigator hours</Label>
            <Input id="capacity" type="number" min={0} className="h-9 w-28" value={capacity} onChange={(e) => setCapacity(Math.max(0, Number(e.target.value) || 0))} />
          </div>
          {q.data && (
            <div className="min-w-[12rem] flex-1 space-y-1.5" aria-live="polite">
              <p className="text-sm text-muted-foreground">
                {q.data.items.filter((i) => i.inCapacity).length} of {q.data.items.length} cases fit in{' '}
                {q.data.usedHours.toFixed(1)} / {q.data.capacityHours} h
              </p>
              <div className="h-1 rounded bg-muted" role="presentation"><AnimatedBar value={cap ? Math.min(1, used / cap) : 0} className="bg-[var(--signal)]" /></div>
            </div>
          )}
        </div>
      </header>

      {q.isError && <p role="alert">The queue could not be loaded.</p>}
      {q.isPending && <p>Loading queue…</p>}
      {q.data && q.data.items.length === 0 && <p>No cases in this run.</p>}
      {q.data && q.data.items.length > 0 && shown.length === 0 && <p className="text-sm text-muted-foreground">{t('queue.noMatch')}</p>}
      {shown.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="eyebrow w-8" />
              <TableHead className="eyebrow">#</TableHead>
              <TableHead className="eyebrow">Tier</TableHead>
              <TableHead className="eyebrow">Case</TableHead>
              <TableHead className="eyebrow">Subjects</TableHead>
              <TableHead className="eyebrow">Pattern</TableHead>
              <TableHead className="eyebrow text-right">Potential $</TableHead>
              <TableHead className="eyebrow">Signals</TableHead>
              <TableHead className="eyebrow text-right">Hours</TableHead>
              <TableHead className="eyebrow">Status</TableHead>
              <TableHead className="eyebrow">Capacity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={body}>
            {shown.map((i) => {
              const isOpen = open === i.caseId
              return (
                <Fragment key={i.caseId}>
                  <TableRow data-row className="row-hover cursor-pointer" onClick={() => setOpen(isOpen ? null : i.caseId)} style={{ boxShadow: `inset 3px 0 0 ${i.tier === 'HIGH' ? 'var(--tier-high)' : 'var(--tier-medium)'}` }}>
                    <TableCell>
                      <button type="button" aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${i.caseId}`} aria-expanded={isOpen} onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : i.caseId) }} className="grid h-6 w-6 place-items-center rounded hover:bg-muted">
                        <ChevronRight aria-hidden className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      </button>
                    </TableCell>
                    <TableCell className="mono text-xs text-muted-foreground">{i.rank}</TableCell>
                    <TableCell>
                      <TierBadge tier={i.tier} />
                    </TableCell>
                    <TableCell>
                      <Link className="font-medium underline-offset-4 hover:underline" to={`/cases/${i.caseId}`} onClick={(e) => e.stopPropagation()}>
                        {i.caseId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{i.subjects.map((s) => s.id).join(', ')}</TableCell>
                    <TableCell className="mono text-xs">{i.hypotheses.join(', ')}</TableCell>
                    <TableCell className="num text-right">
                      {money(i.dollars.exact + i.dollars.estimated)}
                      {i.dollars.estimated > 0 && <span className="block text-xs text-muted-foreground">of which estimated {money(i.dollars.estimated)}</span>}
                    </TableCell>
                    <TableCell><Meters f={i.factors} /></TableCell>
                    <TableCell className="num text-right">{i.estHours.toFixed(1)}</TableCell>
                    <TableCell className="mono text-xs">{i.status}</TableCell>
                    <TableCell className="text-xs">{i.inCapacity ? 'In capacity' : `Deferred: ${i.deferReason}`}</TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={11} className="bg-muted/40 px-6">
                        <Why i={i} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      )}

      {monitor.data && monitor.data.items.length > 0 && (
        <section className="space-y-3 border-t pt-8" aria-labelledby="mon-h">
          <p className="eyebrow">Watched, not worked</p>
          <h2 id="mon-h" className="text-lg font-semibold">Monitor list ({monitor.data.items.length})</h2>
          <p className="text-sm text-muted-foreground">Signals that are not strong enough to open a case.</p>
          <ul className="divide-y border-y text-sm">
            {monitor.data.items.map((m) => (
              <li key={m.monitorId} className="py-2.5">
                <strong className="mono text-xs">{m.providerId}</strong> · {(m.reasons.tierReasons ?? []).join(' ')}
                {m.whatWouldRaiseConfidence.length > 0 && <span className="block text-xs text-muted-foreground">What would raise confidence: {m.whatWouldRaiseConfidence.join('; ')}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
