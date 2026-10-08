import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { money, TierBadge } from '@/components/TierBadge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import type { QueueResponse } from '@/lib/types'

const pct = (v: number) => v.toFixed(2)

export function QueuePage() {
  const [horizon, setHorizon] = useState(90)
  const [capacity, setCapacity] = useState(240)
  const q = useQuery<QueueResponse>({
    queryKey: ['queue', horizon, capacity],
    queryFn: () => api<QueueResponse>(`/api/queue?horizon=${horizon}&capacityHours=${capacity}`),
    placeholderData: keepPreviousData,
  })

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="text-xl font-semibold">SIU queue</h1>
        <div className="space-y-1">
          <Label htmlFor="horizon">Risk horizon</Label>
          <select
            id="horizon"
            className="h-9 rounded-md border px-2"
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
          >
            {[30, 60, 90].map((h) => (
              <option key={h} value={h}>{`${h} days`}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="capacity">Investigator hours</Label>
          <Input
            id="capacity"
            type="number"
            min={0}
            className="w-28"
            value={capacity}
            onChange={(e) => setCapacity(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        {q.data && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {q.data.items.filter((i) => i.inCapacity).length} of {q.data.items.length} cases fit in{' '}
            {q.data.usedHours.toFixed(1)} / {q.data.capacityHours} h
          </p>
        )}
      </div>

      {q.isError && <p role="alert">The queue could not be loaded.</p>}
      {q.isPending && <p>Loading queue…</p>}
      {q.data && q.data.items.length === 0 && <p>No cases in this run.</p>}
      {q.data && q.data.items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Case</TableHead>
              <TableHead>Subjects</TableHead>
              <TableHead>Pattern</TableHead>
              <TableHead className="text-right">Exact $</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Impact</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Evidence</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Capacity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.items.map((i) => (
              <TableRow key={i.caseId}>
                <TableCell>{i.rank}</TableCell>
                <TableCell>
                  <TierBadge tier={i.tier} />
                </TableCell>
                <TableCell>
                  <Link className="underline" to={`/cases/${i.caseId}`}>
                    {i.caseId}
                  </Link>
                </TableCell>
                <TableCell>{i.subjects.map((s) => s.id).join(', ')}</TableCell>
                <TableCell>{i.hypotheses.join(', ')}</TableCell>
                <TableCell className="text-right tabular-nums">{money(i.dollars.exact)}</TableCell>
                <TableCell className="tabular-nums">{pct(i.factors.risk)}</TableCell>
                <TableCell className="tabular-nums">{pct(i.factors.memberImpact)}</TableCell>
                <TableCell className="tabular-nums">{pct(i.factors.severity)}</TableCell>
                <TableCell className="tabular-nums">{pct(i.factors.evidenceStrength)}</TableCell>
                <TableCell className="text-right tabular-nums">{i.estHours.toFixed(1)}</TableCell>
                <TableCell>{i.status}</TableCell>
                <TableCell>{i.inCapacity ? 'In capacity' : `Deferred: ${i.deferReason}`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
