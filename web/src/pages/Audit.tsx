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
  const allowed = !!me && me.role !== 'INVESTIGATOR'
  const q = useInfiniteQuery<Page>({
    queryKey: ['audit'],
    enabled: allowed,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => api<Page>(`/api/audit?limit=25${pageParam ? `&cursor=${pageParam}` : ''}`),
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
              <TableCell>{e.entityId ?? ''}</TableCell>
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
