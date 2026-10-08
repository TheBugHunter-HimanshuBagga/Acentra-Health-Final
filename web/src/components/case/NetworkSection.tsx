import { useQuery } from '@tanstack/react-query'
import cytoscape from 'cytoscape'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { CaseGraph } from '@/lib/types2'

const COLORS: Record<string, string> = { provider: '#4f46e5', owner: '#0d9488', member: '#94a3b8' }

/** Ownership, referral and billing links around the case. The graph is a view of validated links, never a verdict. */
export function NetworkSection({ caseId }: { caseId: string }) {
  const q = useQuery<CaseGraph>({ queryKey: ['graph', caseId], queryFn: () => api(`/api/cases/${caseId}/graph`) })
  const box = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    if (!q.data || !box.current || q.data.nodes.length === 0) return
    let cy: cytoscape.Core | null = null
    try {
      const dark = document.documentElement.classList.contains('dark')
      cy = cytoscape({
        container: box.current,
        elements: [
          ...q.data.nodes.map((n) => ({ data: { id: n.id, label: n.label, type: n.type, role: n.role ?? '' }, position: n.x != null && n.y != null ? { x: n.x, y: n.y } : undefined })),
          ...q.data.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, label: e.label, type: e.type } })),
        ],
        layout: q.data.nodes.every((n) => n.x != null && n.y != null) ? { name: 'preset' } : { name: 'cose', animate: false },
        style: [
          { selector: 'node', style: { label: 'data(label)', 'font-size': 10, color: dark ? '#e5e7eb' : '#1f2937', 'text-valign': 'bottom', 'text-margin-y': 4, 'background-color': (el: cytoscape.NodeSingular) => COLORS[el.data('type') as string] ?? '#64748b', width: 22, height: 22 } },
          { selector: 'node[role = "PRIMARY"]', style: { width: 34, height: 34, 'border-width': 3, 'border-color': '#dc2626' } },
          { selector: 'node[type = "member"]', style: { shape: 'ellipse', width: 14, height: 14 } },
          { selector: 'node[type = "owner"]', style: { shape: 'diamond' } },
          { selector: 'edge', style: { width: 1.5, 'line-color': dark ? '#64748b' : '#94a3b8', 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'target-arrow-color': dark ? '#64748b' : '#94a3b8', label: 'data(label)', 'font-size': 8, color: dark ? '#9ca3af' : '#6b7280' } },
        ],
        userZoomingEnabled: true,
        minZoom: 0.3,
        maxZoom: 3,
      })
      cy.on('tap', 'node', (ev) => setPicked(ev.target.id() as string))
      cy.fit(undefined, 24)
    } catch {
      // no canvas (very old browser or test): the table below carries the same information
    }
    return () => cy?.destroy()
  }, [q.data])

  if (q.isError) return <p className="text-sm text-muted-foreground">The network view is not available for this case.</p>
  if (!q.data) return <p>Loading network…</p>
  if (q.data.nodes.length <= 1) return <p className="text-sm">No ownership, referral or shared-infrastructure links were found around this provider.</p>
  const node = picked ? q.data.nodes.find((n) => n.id === picked) : null

  return (
    <div className="space-y-3">
      <div ref={box} className="surface h-80 w-full" role="img" aria-label={`Network graph with ${q.data.nodes.length} nodes and ${q.data.edges.length} links`} />
      <p className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span><span style={{ color: COLORS.provider }}>●</span> provider</span>
        <span><span style={{ color: COLORS.owner }}>◆</span> owner</span>
        <span><span style={{ color: COLORS.member }}>●</span> member</span>
        <span>red ring = primary provider; click a node for details</span>
      </p>
      {node && (
        <p className="text-sm" role="status">
          <strong>{node.id}</strong> · {node.type}{node.specialty ? ` · ${node.specialty}` : ''}{node.role ? ` · ${node.role.toLowerCase()}` : ''}
        </p>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer">Links as a list ({q.data.edges.length})</summary>
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          {q.data.edges.map((e) => (
            <li key={e.id}>{e.source} → {e.target}: {e.label}{e.nClaims ? ` (${e.nClaims} claims)` : ''}</li>
          ))}
        </ul>
      </details>
    </div>
  )
}
