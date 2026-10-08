import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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

export function AuditPage() {
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

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Audit trail</h1>
        <Button onClick={verify}>Verify chain</Button>
        {verification && (
          <span role="status">
            {verification.ok
              ? `Chain verified: ${verification.checked} events intact.`
              : `Chain BROKEN at event ${verification.firstBadSeq}.`}
          </span>
        )}
        {error && <span role="alert">{error}</span>}
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="space-y-1"><span className="block">Case or entity</span><input aria-label="Entity filter" className="h-9 rounded-md border bg-background px-2" placeholder="CASE-0001" value={entity} onChange={(e) => setEntity(e.target.value.trim())} /></label>
        <label className="space-y-1"><span className="block">Event type</span><input aria-label="Event type filter" className="h-9 rounded-md border bg-background px-2" placeholder="CASE_CLOSED" value={type} onChange={(e) => setType(e.target.value.trim().toUpperCase())} /></label>
        <p className="text-muted-foreground">Filtering by a case shows its full decision trail, in order.</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Time (UTC)</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Hash</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {q.data?.pages.flatMap((p) => p.items).map((e) => (
            <TableRow key={e.seq}>
              <TableCell>{e.seq}</TableCell>
              <TableCell>{e.ts.slice(0, 19).replace('T', ' ')}</TableCell>
              <TableCell>{e.actor} ({e.role})</TableCell>
              <TableCell>{e.eventType}</TableCell>
              <TableCell>{e.entityId ?? ''}{e.payload && Object.keys(e.payload).length > 0 && (<details className="text-xs"><summary className="cursor-pointer">details</summary><pre className="mono max-w-md whitespace-pre-wrap">{JSON.stringify(e.payload, null, 1)}</pre></details>)}</TableCell>
              <TableCell className="font-mono text-xs">{e.hash.slice(0, 10)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {q.hasNextPage && (
        <Button variant="outline" onClick={() => q.fetchNextPage()}>
          Load older events
        </Button>
      )}
    </section>
  )
}
