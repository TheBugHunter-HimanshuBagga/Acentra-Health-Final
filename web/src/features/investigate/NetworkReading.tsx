// An AI reading of the relationship network: counts come from the backend (never the model), the narrative is written
// only from the stored graph and the case's relationship evidence, and it carries the validated / fallback badge.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AiBadge, Sentences } from '@/components/insight/CopilotViews'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import type { GroundedOutput } from '@/lib/types2'

export function NetworkReading({ caseId, canGenerate }: { caseId: string; canGenerate: boolean }) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const q = useQuery<GroundedOutput>({ queryKey: ['network-analysis', caseId], queryFn: () => api(`/api/cases/${caseId}/network-analysis`) })
  const make = useMutation({
    mutationFn: (force: boolean) => api<GroundedOutput>(`/api/cases/${caseId}/network-analysis?force=${force}`, { method: 'POST' }),
    onSuccess: (r) => { setError(null); qc.setQueryData(['network-analysis', caseId], { ...r, available: true }) },
    onError: (e) => setError(e instanceof ApiError ? e.detail : 'The reading could not be made.'),
  })
  const a = q.data
  const s = a?.available ? a.content.sections : undefined
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">{a?.available && <AiBadge r={a} />}</div>
      {!s && <p className="text-muted-foreground">An explanation of what these links mean, written only from the stored graph and the case's relationship evidence, with the counts computed by the backend.</p>}
      {canGenerate && (
        <Button size="sm" variant="outline" disabled={make.isPending} onClick={() => make.mutate(!!a?.available)}>
          {make.isPending ? 'Reading the network…' : a?.available ? 'Regenerate' : 'Explain this network'}
        </Button>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {a?.available && a.content.metrics && (
        <dl className="grid grid-cols-3 gap-2">
          {a.content.metrics.map((m) => (
            <div key={m.label} className="rounded-lg border p-2"><dt className="eyebrow !text-[0.58rem]">{m.label}</dt><dd className="figure text-xl">{m.value}</dd>{m.detail && <p className="mono truncate text-[0.58rem] text-muted-foreground">{m.detail}</p>}</div>
          ))}
        </dl>
      )}
      {s && (
        <div className="space-y-3">
          {s.headline?.[0] && <p className="font-medium leading-snug">{s.headline[0].text}</p>}
          <Sentences items={s.relationships ?? []} />
          {(s.standsOut?.length ?? 0) > 0 && (<><p className="eyebrow">What stands out</p><Sentences items={s.standsOut} tone="against" /></>)}
          <p className="eyebrow">Verify before acting</p>
          <Sentences items={s.verify ?? []} />
        </div>
      )}
    </div>
  )
}
