import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { Brief, BriefLine, Me } from '@/lib/types'

const CAN_GENERATE = new Set(['INVESTIGATOR', 'SUPERVISOR'])

function Cites({ ids }: { ids: string[] }) {
  return (
    <span className="ml-1 whitespace-nowrap text-xs text-muted-foreground" aria-label={`Evidence ${ids.join(', ')}`}>
      {ids.map((id) => `[${id}]`).join('')}
    </span>
  )
}

function Line({ line }: { line: BriefLine }) {
  return (
    <li>
      {line.text}
      <Cites ids={line.cites} />
    </li>
  )
}

/** The investigation brief: validated text with a citation on every line. Read-only for roles that cannot generate. */
export function BriefPanel({ caseId, me }: { caseId: string; me: Me }) {
  const qc = useQueryClient()
  const key = ['brief', caseId]
  const brief = useQuery<Brief | null>({
    queryKey: key,
    // 204 means no brief yet; React Query forbids undefined data, so it becomes null
    queryFn: async () => (await api<Brief | undefined>(`/api/cases/${caseId}/brief`)) ?? null,
  })
  const generate = useMutation({
    mutationFn: () => api<Brief>(`/api/cases/${caseId}/brief`, { method: 'POST' }),
    onSuccess: (b) => {
      qc.setQueryData(key, b)
      void qc.invalidateQueries({ queryKey: ['case', caseId] })
    },
  })

  if (brief.isLoading) return <p className="text-sm">Loading brief…</p>
  if (brief.isError) return <p role="alert" className="text-sm">The brief could not be loaded.</p>

  const b = brief.data
  if (!b) {
    return (
      <div className="space-y-2">
        <p className="text-sm">No investigation brief has been generated for this case yet.</p>
        {CAN_GENERATE.has(me.role) ? (
          <Button size="sm" disabled={generate.isPending} onClick={() => generate.mutate()}>
            {generate.isPending ? 'Generating…' : 'Generate investigation brief'}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Your role can read briefs but not generate them.</p>
        )}
        {generate.isError && (
          <p role="alert" className="text-sm">
            {(generate.error as Error).message}
          </p>
        )}
      </div>
    )
  }

  const s = b.sections
  const warnings = b.validation.checks.filter((c) => c.status === 'WARN')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className="rounded border px-2 py-0.5 font-medium"
          data-testid="brief-badge"
          title={b.validation.fallbackReason ?? 'Passed every validation check'}
        >
          {b.badge === 'VALIDATED' ? 'Validated' : 'Template (validation fallback)'}
        </span>
        <span className="text-muted-foreground">
          {b.mode === 'LLM' ? `Model-written (${b.model})` : 'Built from the evidence pack by fixed rules'} ·{' '}
          {b.briefId} · {b.generatedAt.slice(0, 19).replace('T', ' ')}
        </span>
      </div>
      <p className="font-medium">
        {s.headline.text}
        <Cites ids={s.headline.cites} />
      </p>
      {s.insufficientEvidence && (
        <p role="note" className="rounded border p-2 text-sm">
          Insufficient evidence: this item is monitored, not opened as a case.
        </p>
      )}
      {s.sections.map((sec) => (
        <section key={sec.key} aria-label={sec.title} className="space-y-1">
          <h3 className="font-medium">{sec.title}</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {sec.items.map((l, i) => (
              <Line key={`${sec.key}-${i}`} line={l} />
            ))}
          </ul>
        </section>
      ))}
      <details className="text-sm">
        <summary>
          Validation: {b.validation.passed ? 'passed' : 'failed'} · {b.validation.checks.length} checks · {warnings.length}{' '}
          warning{warnings.length === 1 ? '' : 's'}
        </summary>
        <ul className="mt-1 space-y-0.5 pl-5">
          {b.validation.checks.map((c) => (
            <li key={c.id}>
              {c.id} {c.name}: {c.status}
              {c.details.length > 0 && ` (${c.details.join('; ')})`}
            </li>
          ))}
        </ul>
        {b.validation.fallbackReason && <p className="mt-1">Fallback reason: {b.validation.fallbackReason}</p>}
      </details>
      <p className="text-xs text-muted-foreground">
        Indicators for human review, not findings. Every line cites the evidence it comes from.
      </p>
    </div>
  )
}
