import { PageHeader } from '@/components/kit/section'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProvChip } from '@/components/Provenance'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import { useMe } from '@/lib/auth'
import type { AuditEvent } from '@/lib/types'

interface Page {
  items: AuditEvent[]
  nextCursor: number | null
}

interface Verification {
  ok: boolean
  checked: number
  firstBadSeq: number | null
}

const short = (h?: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : '—')

/** Events that record a person's decision get the HUMAN DECISION label. */
const HUMAN = /REVIEW|APPROV|CLOSED|COSIGN|CO_SIGN|PRECEDENT|EXCEPTION|ACTION/

export function AuditPage() {
  const { t } = useTranslation()
  const me = useMe().data
  const [verification, setVerification] = useState<Verification | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [entity, setEntity] = useState('')
  const [type, setType] = useState('')
  const allowed = !!me && me.role !== 'INVESTIGATOR'
  const q = useInfiniteQuery<Page>({
    queryKey: ['audit', entity, type],
    enabled: allowed,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => api<Page>(`/api/audit?limit=25${pageParam ? `&cursor=${pageParam}` : ''}${entity ? `&entityId=${encodeURIComponent(entity)}` : ''}${type ? `&type=${encodeURIComponent(type)}` : ''}`),
    getNextPageParam: (last) => last.nextCursor,
  })

  if (!me) return null
  if (!allowed) return <p>The audit trail is available to supervisors, governance and auditors.</p>

  async function verify() {
    setError(null)
    try {
      setVerification(await api<Verification>('/api/audit/verify'))
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'Verification failed to run.')
    }
  }

  const events = q.data?.pages.flatMap((p) => p.items) ?? []
  const verified = verification?.ok === true
  const field = 'h-9 rounded-md border bg-transparent px-2 text-sm'

  return (
    <section className="space-y-8">
      <header className="space-y-3">
        <PageHeader eyebrow="Accountability" lead="Audit" accent="trail" inline lede="Every important decision is accountable: each event is chained to the one before it by a hash, so an edit anywhere breaks the chain." />
      </header>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-y py-4">
        <label className="space-y-1"><span className="eyebrow block">Case or entity</span><input aria-label="Entity filter" className={field} placeholder="CASE-0001" value={entity} onChange={(e) => setEntity(e.target.value.trim())} /></label>
        <label className="space-y-1"><span className="eyebrow block">Event type</span><input aria-label="Event type filter" className={field} placeholder="CASE_CLOSED" value={type} onChange={(e) => setType(e.target.value.trim().toUpperCase())} /></label>
        <Button onClick={verify}>Verify chain</Button>
        {verification && (
          <span role="status" className={`text-sm ${verified ? 'text-[var(--ok)]' : 'text-[var(--tier-high)]'}`}>
            {verified ? `Chain verified: ${verification.checked} events intact.` : `Chain BROKEN at event ${verification.firstBadSeq}.`}
          </span>
        )}
        {error && <span role="alert">{error}</span>}
        <p className="basis-full text-xs text-muted-foreground">Filtering by a case shows its full decision trail, in order.</p>
      </div>

      <ol className="relative space-y-0" aria-label="Audit events">
        <span aria-hidden className={`absolute bottom-0 left-[0.55rem] top-2 w-px transition-colors duration-1000 ${verified ? 'bg-[var(--ok)]' : 'bg-border'}`} />
        {events.map((e, i) => (
          <li key={e.seq} className="relative grid gap-x-4 gap-y-1 pb-6 pl-8 md:grid-cols-[1fr_auto]">
            <span
              aria-hidden
              className={`absolute left-0 top-1.5 grid h-[1.15rem] w-[1.15rem] place-items-center rounded-full border-2 bg-background transition-colors ${verified ? 'border-[var(--ok)]' : 'border-border'}`}
              style={{ transitionDelay: verified ? `${Math.min(i, 30) * 40}ms` : '0ms' }}
            >
              {verified && <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />}
            </span>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono text-xs text-muted-foreground">#{e.seq}</span>
                <span className="font-medium">{e.eventType}</span>
                {HUMAN.test(e.eventType) && <ProvChip kind="human" />}
              </div>
              <p className="text-sm text-muted-foreground">
                {e.actor} ({e.role}) · <span className="mono text-xs">{e.ts.slice(0, 19).replace('T', ' ')}</span>
                {e.entityId ? <> · <span className="mono text-xs">{e.entityId}</span></> : null}
              </p>
              {e.payload && Object.keys(e.payload).length > 0 && (
                <details className="text-xs">
                  <summary className="eyebrow cursor-pointer">details</summary>
                  <pre className="mono mt-1 max-w-xl whitespace-pre-wrap text-muted-foreground">{JSON.stringify(e.payload, null, 1)}</pre>
                </details>
              )}
            </div>
            <p className="mono text-[0.7rem] leading-relaxed text-muted-foreground md:text-right" title={`${t('audit.chain')} ${e.hash}`}>
              <span className="block">{short(e.hash)}</span>
              <span className="block opacity-70">{t('audit.prev')} {short(e.prevHash)}</span>
            </p>
          </li>
        ))}
      </ol>
      {q.hasNextPage && (
        <Button variant="outline" onClick={() => q.fetchNextPage()}>
          Load older events
        </Button>
      )}
    </section>
  )
}
