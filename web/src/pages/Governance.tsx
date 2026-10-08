import { PageHeader } from '@/components/kit/section'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { money } from '@/components/TierBadge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '@/lib/api'
import { useMe } from '@/lib/auth'
import type { Role } from '@/lib/types'
import type { ExceptionRule, RunSummary } from '@/lib/types2'

interface Job {
  jobId: string
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'NOT_STARTED'
  stage?: string | null
  reason?: string | null
  resultRunId?: string | null
  error?: string | null
  detail?: string
}

const STATUS_TEXT: Record<ExceptionRule['status'], string> = {
  DRAFT: 'Draft: simulate it first',
  SIMULATED: 'Simulated: ready to submit',
  PENDING_APPROVAL: 'Waiting for governance approval',
  APPROVED: 'Approved and active',
  REJECTED: 'Rejected',
  RETIRED: 'Retired',
}

const EFFECT_TEXT: Record<string, string> = {
  DOWNGRADE_TO_MONITOR: 'Move matching cases to the monitor list',
  SUPPRESS_ALERT: 'Do not raise matching alerts',
}

function can(role: Role | undefined, ...allowed: Role[]) {
  return !!role && allowed.includes(role)
}

function errText(e: unknown) {
  return e instanceof ApiError ? e.detail : 'That did not work. Please try again.'
}

const STEPS: { key: ExceptionRule['status']; label: string }[] = [
  { key: 'DRAFT', label: 'Draft' },
  { key: 'SIMULATED', label: 'Simulated' },
  { key: 'PENDING_APPROVAL', label: 'Approval' },
  { key: 'APPROVED', label: 'Active' },
]

/** Where an exception is in its governed life, and who still has to act. Two different people are always required. */
function Stepper({ x }: { x: ExceptionRule }) {
  const idx = Math.max(0, STEPS.findIndex((s) => s.key === x.status))
  const ended = x.status === 'REJECTED' || x.status === 'RETIRED'
  return (
    <div className="space-y-2">
      <ol className="flex items-center" aria-label="Governance progress">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex flex-1 items-center last:flex-none">
            <span className="flex items-center gap-2">
              <span className={`grid h-5 w-5 place-items-center rounded-full border-2 text-[0.6rem] ${!ended && i < idx ? 'border-[var(--ok)] bg-[var(--ok)] text-background' : !ended && i === idx ? 'border-[var(--signal)] text-[var(--signal)]' : 'border-border text-muted-foreground'}`}>{!ended && i < idx ? '✓' : i + 1}</span>
              <span className={`eyebrow ${i === idx && !ended ? 'text-foreground' : ''}`}>{s.label}</span>
            </span>
            {i < STEPS.length - 1 && <span aria-hidden className={`mx-3 h-px flex-1 ${!ended && i < idx ? 'bg-[var(--ok)]' : 'bg-border'}`} />}
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        <span className="chip chip-human mr-2">Two people</span>
        proposed by <strong>{x.proposedBy}</strong>{x.approvedBy ? <>, decided by <strong>{x.approvedBy}</strong></> : ', approval needs a different person in the governance role'}
      </p>
    </div>
  )
}

function ExceptionCard({ x, role, onError, open }: { x: ExceptionRule; role?: Role; onError: (m: string | null) => void; open: boolean }) {
  const qc = useQueryClient()
  const [notes, setNotes] = useState('')
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['exceptions'] })
    void qc.invalidateQueries({ queryKey: ['jobs'] })
    void qc.invalidateQueries({ queryKey: ['runs'] })
  }
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api<ExceptionRule>(`/api/exceptions/${x.excId}/${path}`, { method: 'POST', body }),
    onSuccess: () => {
      onError(null)
      refresh()
    },
    onError: (e) => onError(errText(e)),
  })
  const sim = x.simulation
  const explanation = typeof x.explanation === 'object' && x.explanation ? (x.explanation as { text?: string; mode?: string }) : null
  return (
    <article className="panel space-y-4 p-5" aria-label={x.excId} id={x.excId} data-open={open}>
      <header className="flex flex-wrap items-center gap-3">
        <h3 className="font-medium"><span className="mono">{x.excId}</span> v{x.version}</h3>
        <span className="rounded-full border px-2 py-0.5 text-xs" data-testid={`exc-status-${x.excId}`}>{STATUS_TEXT[x.status]}</span>
        <span className="text-sm text-muted-foreground">proposed by {x.proposedBy}{x.approvedBy ? ` · decided by ${x.approvedBy}` : ''}</span>
      </header>
      <Stepper x={x} />
      <p className="text-sm">
        <strong>{EFFECT_TEXT[x.effect] ?? x.effect}</strong> when rule {x.scope.rule_ids.join(', ')}
        {x.scope.specialty_code ? ` for ${x.scope.specialty_code}` : ''} fires and:
      </p>
      <ul className="list-disc pl-5 text-sm">
        {x.condition.map((c, i) => <li key={i}><span className="mono text-xs">{c.field} {c.op} {String(c.value)}</span></li>)}
      </ul>
      <p className="text-xs text-muted-foreground">
        Supported by {x.supportN} similar closures{x.sourcePrecedentId ? ` · from ${x.sourcePrecedentId}` : ''}{x.reviewDue ? ` · review due ${x.reviewDue}` : ''}
        {x.status === 'APPROVED' && typeof x.suppressedInLastRun === 'number' ? ` · removed ${x.suppressedInLastRun} alerts in the last run` : ''}
      </p>
      {x.lintVerdict && <p className="text-sm">Safety check: <strong>{x.lintVerdict}</strong> {x.flags.length > 0 && <span className="text-muted-foreground">({x.flags.map((f) => (typeof f === 'string' ? f : (f as { text?: string; code?: string }).text ?? (f as { code?: string }).code)).join('; ')})</span>}</p>}

      {sim && (
        <div className="rounded-md bg-muted p-3 text-sm" aria-label="Simulation result">
          <p className="font-medium">If this had been active on the current data:</p>
          <ul className="list-disc pl-5">
            <li>{sim.alertsSuppressed} alerts would not be raised, across {sim.providersAffected} providers and {sim.casesAffected} cases.</li>
            <li>{money(sim.dollarsNoLongerReviewed)} would no longer be reviewed.</li>
            <li>{sim.conflictsWithConfirmed.length === 0 ? 'It does not touch any case a person confirmed.' : `It touches confirmed cases: ${sim.conflictsWithConfirmed.join(', ')}.`}</li>
            <li>{sim.hardFactTouches === 0 ? 'No recorded-fact alert is affected.' : `${sim.hardFactTouches} recorded-fact alerts are affected.`}</li>
            {Object.keys(sim.tierShifts).length > 0 && <li>Tier shifts: {Object.entries(sim.tierShifts).map(([k, v]) => `${k} ×${v}`).join(', ')}.</li>}
            <li>Breadth: {(sim.breadthShare * 100).toFixed(1)}% of providers.</li>
          </ul>
        </div>
      )}
      {explanation?.text && <p className="text-sm text-muted-foreground">{explanation.text}</p>}

      {(x.status === 'PENDING_APPROVAL') && can(role, 'GOVERNANCE') && (
        <div className="space-y-2">
          <label className="text-sm" htmlFor={`n-${x.excId}`}>Decision notes (required to reject)</label>
          <Textarea id={`n-${x.excId}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      )}
      {x.status === 'PENDING_APPROVAL' && !can(role, 'GOVERNANCE') && (
        <p className="text-sm text-muted-foreground">Only the governance role can approve. The person who proposed it cannot.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {['DRAFT', 'SIMULATED', 'PENDING_APPROVAL'].includes(x.status) && can(role, 'INVESTIGATOR', 'SUPERVISOR', 'GOVERNANCE') && (
          <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ path: 'simulate' })}>{sim ? 'Simulate again' : 'Simulate'}</Button>
        )}
        {x.status === 'SIMULATED' && can(role, 'INVESTIGATOR', 'SUPERVISOR') && (
          <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ path: 'submit' })}>Submit for approval</Button>
        )}
        {x.status === 'PENDING_APPROVAL' && can(role, 'GOVERNANCE') && (
          <>
            <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ path: 'approve', body: { decision: 'APPROVE', notes } })}>Approve and re-run</Button>
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ path: 'approve', body: { decision: 'REJECT', notes } })}>Reject</Button>
          </>
        )}
        {x.status === 'APPROVED' && can(role, 'GOVERNANCE') && (
          <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ path: 'retire' })}>Retire and re-run</Button>
        )}
        <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ path: 'explain' })}>Explain in plain words</Button>
      </div>
    </article>
  )
}

function signed(n: number) {
  return n > 0 ? `+${n}` : String(n)
}

function DiffPanel({ runs }: { runs: RunSummary[] }) {
  const latest = runs[0]
  if (!latest) return null
  const d = latest.diff as {
    fromRun?: string; alerts?: number; active?: number; cases?: number; inCapacity?: number
    tierChanges?: { caseId: string; from: string; to: string; via: string | null }[]
    newCases?: string[]; dollarsExact?: number; dollarsEstimated?: number
  }
  return (
    <section className="surface space-y-2 p-4" aria-labelledby="diff-h">
      <h2 id="diff-h" className="font-medium">What the latest run changed</h2>
      <p className="text-sm">
        <span className="mono">{latest.runId}</span>{latest.diffFrom ? ` compared with ${latest.diffFrom}` : ' is the first run'} · {latest.stages.map((s) => `${s.label} ${s.count}`).join(' → ')}
      </p>
      {latest.diffFrom && (
        <p className="text-sm text-muted-foreground">
          Alerts {signed(d.alerts ?? 0)}, active {signed(d.active ?? 0)}, cases {signed(d.cases ?? 0)}, inside capacity {signed(d.inCapacity ?? 0)}; exact dollars {signed(d.dollarsExact ?? 0)}, estimated {signed(d.dollarsEstimated ?? 0)}.
        </p>
      )}
      {d.tierChanges && d.tierChanges.length > 0 ? (
        <ul className="list-disc pl-5 text-sm">
          {d.tierChanges.map((c) => <li key={c.caseId}>{c.caseId}: {c.from} to {c.to}{c.via ? `, because of ${c.via}` : ''}</li>)}
        </ul>
      ) : (
        latest.diffFrom && <p className="text-sm text-muted-foreground">No case changed tier in the latest run.</p>
      )}
      {Object.keys(latest.suppressedByException).length > 0 && (
        <p className="text-sm text-muted-foreground">Alerts removed: {Object.entries(latest.suppressedByException).map(([k, v]) => `${k} ${v}`).join(', ')}.</p>
      )}
      {Array.isArray(d.newCases) && d.newCases.length > 0 && <p className="text-sm">New cases: {d.newCases.join(', ')}.</p>}
    </section>
  )
}

/** Rule exceptions: propose from a closed case, simulate on real data, approve by a second person, then re-run and see the diff. */
export function GovernancePage() {
  const me = useMe().data
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const focus = params.get('exc')

  const list = useQuery<ExceptionRule[]>({ queryKey: ['exceptions'], queryFn: () => api('/api/exceptions') })
  const runs = useQuery<RunSummary[]>({ queryKey: ['runs'], queryFn: () => api('/api/runs') })
  const jobs = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api('/api/jobs'),
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING') ? 1500 : false),
  })
  const rerun = useMutation({
    mutationFn: () => api<Job>('/api/runs/rerun', { method: 'POST' }),
    onSuccess: (j) => {
      setError(null)
      setMessage(j.status === 'NOT_STARTED' ? (j.detail ?? 'The engine is unavailable; stored results are unchanged.') : 'Re-run started.')
      void qc.invalidateQueries({ queryKey: ['jobs'] })
    },
    onError: (e) => setError(errText(e)),
  })

  const running = jobs.data?.find((j) => j.status === 'QUEUED' || j.status === 'RUNNING')
  const finished = jobs.data?.[0]
  const all = list.data ?? []
  const active = all.filter((x) => ['DRAFT', 'SIMULATED', 'PENDING_APPROVAL'].includes(x.status))
  const approved = all.filter((x) => x.status === 'APPROVED')
  const history = all.filter((x) => ['REJECTED', 'RETIRED'].includes(x.status))

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <PageHeader eyebrow="Governed knowledge" lead="Rules and" accent="exceptions" inline lede="An exception teaches the system that a pattern was legitimate. It is drafted from a co-signed UNFOUNDED closure, simulated on real data, approved by a different person in the governance role, and only then applied in a re-run. Recorded-fact rules (such as billing after a date of death) can never be excepted." />
      </header>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}

      <div className="surface flex flex-wrap items-center gap-3 p-3">
        <Button size="sm" variant="outline" disabled={!!running || rerun.isPending || !can(me?.role, 'INVESTIGATOR', 'SUPERVISOR', 'GOVERNANCE')} onClick={() => rerun.mutate()}>
          Re-run analysis now
        </Button>
        <p className="text-sm" aria-live="polite">
          {running ? `A re-run is ${running.status.toLowerCase()}${running.stage ? ` (${running.stage})` : ''}.` : finished ? `Last re-run: ${finished.status.toLowerCase()}${finished.resultRunId ? ` as ${finished.resultRunId}` : ''}${finished.error ? ` (${finished.error})` : ''}.` : 'No re-run has been requested yet.'}
        </p>
      </div>

      <section aria-labelledby="open-h" className="space-y-3">
        <h2 id="open-h" className="font-medium">In progress ({active.length})</h2>
        {active.length === 0 && <p className="text-sm text-muted-foreground">Nothing is waiting. Propose an exception from a co-signed UNFOUNDED precedent on the Precedents page.</p>}
        {active.map((x) => <ExceptionCard key={`${x.excId}-${x.version}`} x={x} role={me?.role} onError={setError} open={focus === x.excId} />)}
      </section>

      <section aria-labelledby="act-h" className="space-y-3">
        <h2 id="act-h" className="font-medium">Active ({approved.length})</h2>
        {approved.map((x) => <ExceptionCard key={`${x.excId}-${x.version}`} x={x} role={me?.role} onError={setError} open={focus === x.excId} />)}
      </section>

      {runs.data && <DiffPanel runs={runs.data} />}

      {history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Rejected and retired ({history.length})</summary>
          <div className="mt-3 space-y-3">
            {history.map((x) => <ExceptionCard key={`${x.excId}-${x.version}`} x={x} role={me?.role} onError={setError} open={false} />)}
          </div>
        </details>
      )}
    </section>
  )
}
