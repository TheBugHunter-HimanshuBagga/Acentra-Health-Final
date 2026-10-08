import { PageHeader } from '@/components/kit/section'
import { useQuery } from '@tanstack/react-query'
import cytoscape from 'cytoscape'
import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

interface Policy { sectionId: string; docId: string; title: string; body: string; version: string; effDt: string; provenance: string }
interface Rule { ruleId: string; version: number; name: string; schemeType: string; family: string; status: string; policyIds: string[] }
interface Term { termId: string; term: string; definition: string; category: string }
interface Help { articleId: string; title: string; body: string }
interface Finding { findingId?: string; type: string; severity: string; message: string }
interface KGraph { nodes: { id: string; type: string; label: string }[]; edges: { id: string; source: string; target: string; type: string }[] }

const TYPE_COLOR: Record<string, string> = { policy: '#4f86ff', rule: '#18a06b', exception: '#ffd27a', precedent: '#8f78ff' }

function KnowledgeGraph() {
  const q = useQuery<KGraph>({ queryKey: ['kgraph'], queryFn: () => api('/api/knowledge/graph') })
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!q.data || !box.current) return
    let cy: cytoscape.Core | null = null
    try {
      cy = cytoscape({
        container: box.current,
        elements: [
          ...q.data.nodes.map((n) => ({ data: { id: n.id, label: n.id, type: n.type } })),
          ...q.data.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target } })),
        ],
        layout: { name: 'cose', animate: false, nodeRepulsion: () => 9000 },
        style: [
          { selector: 'node', style: { label: 'data(label)', 'font-size': 8, width: 14, height: 14, 'background-color': (el: cytoscape.NodeSingular) => TYPE_COLOR[el.data('type') as string] ?? '#64748b' } },
          { selector: 'edge', style: { width: 1, 'line-color': '#94a3b8', 'curve-style': 'haystack' } },
        ],
      })
    } catch {
      /* the lists above carry the same facts */
    }
    return () => cy?.destroy()
  }, [q.data])
  if (!q.data) return null
  return (
    <section className="space-y-2" aria-labelledby="kg-h">
      <h2 id="kg-h" className="font-medium">How rules, policies, exceptions and precedents connect</h2>
      <div ref={box} className="surface h-72 w-full" role="img" aria-label={`Knowledge graph with ${q.data.nodes.length} items`} />
      <p className="flex gap-3 text-xs text-muted-foreground">
        {Object.entries(TYPE_COLOR).map(([k, c]) => <span key={k}><span style={{ color: c }}>●</span> {k}</span>)}
      </p>
    </section>
  )
}

/** Read-only reference: the policies the evidence cites, the rules that run, the glossary and the platform help. */
export function LibraryPage() {
  const [filter, setFilter] = useState('')
  const policies = useQuery<Policy[]>({ queryKey: ['k-policies'], queryFn: () => api('/api/knowledge/policies') })
  const rules = useQuery<Rule[]>({ queryKey: ['k-rules'], queryFn: () => api('/api/knowledge/rules') })
  const glossary = useQuery<Term[]>({ queryKey: ['k-glossary'], queryFn: () => api('/api/knowledge/glossary') })
  const help = useQuery<Help[]>({ queryKey: ['k-help'], queryFn: () => api('/api/knowledge/help') })
  const lint = useQuery<Finding[]>({ queryKey: ['k-lint'], queryFn: () => api('/api/knowledge/lint') })
  const f = filter.trim().toLowerCase()
  const hit = (...s: string[]) => !f || s.some((x) => x.toLowerCase().includes(f))

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <PageHeader eyebrow="Reference" lead={null} accent="Library" lede="Everything the evidence and the assistant rely on, in one place. The assistant quotes only from here and from validated case evidence." />
        <label className="sr-only" htmlFor="lib-filter">Search the library</label>
        <Input id="lib-filter" className="max-w-sm" placeholder="Search policies, rules, terms" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </header>

      {lint.data && (
        <section className="surface space-y-2 p-4" aria-labelledby="lint-h">
          <h2 id="lint-h" className="font-medium">Knowledge health</h2>
          {lint.data.length === 0 ? (
            <p className="text-sm">No conflicting precedents, stale exceptions or policy drift were found in the latest run.</p>
          ) : (
            <ul className="list-disc pl-5 text-sm">{lint.data.map((x, i) => <li key={i}><strong>{x.severity}</strong> {x.message}</li>)}</ul>
          )}
        </section>
      )}

      <section className="space-y-2" aria-labelledby="pol-h">
        <h2 id="pol-h" className="font-medium">Policies</h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {policies.data?.filter((p) => hit(p.sectionId, p.title, p.body)).map((p) => (
            <li key={p.sectionId} className="surface space-y-1 p-3 text-sm">
              <p><span className="mono text-xs">{p.sectionId}</span> · <strong>{p.title}</strong></p>
              <p>{p.body}</p>
              <p className="text-xs text-muted-foreground">{p.version} · effective {p.effDt} · {p.provenance}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2" aria-labelledby="rules-h">
        <h2 id="rules-h" className="font-medium">Detection rules</h2>
        <ul className="grid gap-2 md:grid-cols-2">
          {rules.data?.filter((r) => hit(r.ruleId, r.name)).map((r) => (
            <li key={r.ruleId} className="surface p-3 text-sm">
              <span className="mono text-xs">{r.ruleId}</span> v{r.version} · {r.name}
              <span className="block text-xs text-muted-foreground">{r.family} · {r.status} · cites {r.policyIds.join(', ') || 'no policy'}</span>
            </li>
          ))}
        </ul>
      </section>

      <KnowledgeGraph />

      <section className="space-y-2" aria-labelledby="gl-h">
        <h2 id="gl-h" className="font-medium">Glossary</h2>
        <dl className="grid gap-3 md:grid-cols-2">
          {glossary.data?.filter((t) => hit(t.term, t.definition)).map((t) => (
            <div key={t.termId} className="surface p-3 text-sm"><dt className="font-medium">{t.term}</dt><dd className="text-muted-foreground">{t.definition}</dd></div>
          ))}
        </dl>
      </section>

      <section className="space-y-2" aria-labelledby="help-h">
        <h2 id="help-h" className="font-medium">Using the platform</h2>
        {help.data?.filter((h) => hit(h.title, h.body)).map((h) => (
          <details key={h.articleId} className="surface p-3 text-sm">
            <summary className="cursor-pointer font-medium">{h.title}</summary>
            <p className="mt-2">{h.body}</p>
          </details>
        ))}
      </section>
    </section>
  )
}
