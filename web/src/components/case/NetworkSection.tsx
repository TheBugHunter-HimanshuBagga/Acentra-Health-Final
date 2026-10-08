import { useQuery } from '@tanstack/react-query'
import cytoscape from 'cytoscape'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { CaseGraph } from '@/lib/types2'

function cssColor(name: string, fallback: string): string {
  try {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c || fallback
  } catch {
    return fallback
  }
}

/** Ownership, referral and billing links around the case. Hovering a node lights its neighbourhood and dims the rest. */
export function NetworkSection({ caseId }: { caseId: string }) {
  const q = useQuery<CaseGraph>({ queryKey: ['graph', caseId], queryFn: () => api(`/api/cases/${caseId}/graph`) })
  const box = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [types, setTypes] = useState({ provider: true, owner: true, member: false })
  const [expanded, setExpanded] = useState<string[]>([])

  useEffect(() => {
    if (!q.data || !box.current || q.data.nodes.length === 0) return
    let cy: cytoscape.Core | null = null
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    try {
      const fg = cssColor('--foreground', '#222')
      const muted = cssColor('--muted-foreground', '#888')
      const line = cssColor('--border', '#bbb')
      const provider = cssColor('--chart-1', '#4f46e5')
      const owner = cssColor('--chart-2', '#0d9488')
      const member = cssColor('--chart-5', '#94a3b8')
      const danger = cssColor('--tier-high', '#dc2626')
      const warn = cssColor('--warn', '#d97706')
      cy = cytoscape({
        container: box.current,
        elements: [
          ...q.data.nodes.map((n) => ({ data: { id: n.id, label: n.label, type: n.type, role: n.role ?? '' }, position: n.x != null && n.y != null ? { x: n.x, y: n.y } : undefined })),
          ...q.data.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, label: e.label, type: e.type } })),
        ],
        layout: q.data.nodes.every((n) => n.x != null && n.y != null) ? { name: 'preset' } : { name: 'cose', animate: false },
        style: [
          { selector: 'node', style: { label: 'data(label)', 'font-size': 10, 'font-family': 'Geist Mono Variable, monospace', color: fg, 'text-valign': 'bottom', 'text-margin-y': 5, 'background-color': (el: cytoscape.NodeSingular) => ({ provider, owner, member })[el.data('type') as string] ?? muted, width: 22, height: 22, 'border-width': 2, 'border-color': line, 'transition-property': 'opacity, width, height', 'transition-duration': 180 } },
          { selector: 'node[role = "PRIMARY"]', style: { width: 36, height: 36, 'border-width': 3, 'border-color': danger } },
          { selector: 'node[type = "member"]', style: { width: 13, height: 13, 'font-size': 0 } },
          { selector: 'node[type = "owner"]', style: { shape: 'diamond' } },
          { selector: 'edge', style: { width: 1.4, 'line-color': line, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'target-arrow-color': line, label: '', 'font-size': 8, color: muted, 'transition-property': 'opacity, line-color', 'transition-duration': 180 } },
          { selector: '.dim', style: { opacity: 0.12 } },
          { selector: 'edge.hot', style: { width: 2.4, 'line-color': provider, 'target-arrow-color': provider, label: 'data(label)' } },
          { selector: 'node.found', style: { 'border-width': 4, 'border-color': warn } },
          { selector: 'node.hot', style: { 'border-color': provider } },
        ],
        userZoomingEnabled: true,
        wheelSensitivity: 0.25,
        minZoom: 0.3,
        maxZoom: 3,
      })
      cy.fit(undefined, 28)
      cyRef.current = cy
      if (!reduce) {
        cy.nodes().style('opacity', 0)
        cy.edges().style('opacity', 0)
        cy.nodes().forEach((n, i) => { n.delay(i * 35, () => undefined).animate({ style: { opacity: 1 } }, { duration: 500, easing: 'ease-out' }) })
        cy.edges().forEach((e, i) => { e.delay(300 + i * 25, () => undefined).animate({ style: { opacity: 1 } }, { duration: 500 }) })
      }
      cy.on('mouseover', 'node', (ev) => {
        const n = ev.target as cytoscape.NodeSingular
        const hood = n.closedNeighborhood()
        cy!.elements().not(hood).addClass('dim')
        hood.addClass('hot')
        box.current?.style.setProperty('cursor', 'pointer')
      })
      cy.on('mouseout', 'node', () => {
        cy!.elements().removeClass('dim hot')
        box.current?.style.setProperty('cursor', 'grab')
      })
      cy.on('tap', 'node', (ev) => {
        const id = ev.target.id() as string
        setPicked(id)
        setExpanded((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))     // expand or collapse its members
      })
      cy.on('tap', (ev) => { if (ev.target === cy) setPicked(null) })
    } catch {
      // no canvas (very old browser or test): the list below carries the same information
    }
    return () => {
      cy?.destroy()
      cyRef.current = null
    }
  }, [q.data])

  // filters, search and expanded neighbourhoods act on the live graph without rebuilding it
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.batch(() => {
      cy.nodes().forEach((n) => {
        const type = n.data('type') as 'provider' | 'owner' | 'member'
        const viaExpand = type === 'member' && n.neighborhood('node').toArray().some((m) => expanded.includes(m.id()))
        n.style('display', types[type] || viaExpand ? 'element' : 'none')
      })
      cy.edges().forEach((e) => {
        e.style('display', e.source().style('display') === 'none' || e.target().style('display') === 'none' ? 'none' : 'element')
      })
      cy.nodes().removeClass('found')
      const needle = query.trim().toLowerCase()
      if (needle) {
        const hit = cy.nodes().filter((n) => n.style('display') !== 'none' && `${n.id()} ${n.data('label')}`.toLowerCase().includes(needle))
        hit.addClass('found')
        if (hit.nonempty()) cy.animate({ fit: { eles: hit, padding: 80 }, duration: 350 })
      }
    })
  }, [types, query, expanded, q.data])

  if (q.isError) return <p className="text-sm text-muted-foreground">The network view is not available for this case.</p>
  if (!q.data) return <div className="h-80 animate-pulse rounded-lg bg-muted" />
  if (q.data.nodes.length <= 1) return <p className="text-sm">No ownership, referral or shared-infrastructure links were found around this provider.</p>
  const node = picked ? q.data.nodes.find((n) => n.id === picked) : null
  const links = picked ? q.data.edges.filter((e) => e.source === picked || e.target === picked) : []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="sr-only" htmlFor="net-search">Search the network</label>
        <input id="net-search" placeholder="Find a provider, owner or member" className="h-8 w-56 rounded-full border bg-transparent px-3" value={query} onChange={(e) => setQuery(e.target.value)} />
        {(['provider', 'owner', 'member'] as const).map((k) => (
          <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={types[k]} onChange={() => setTypes((t) => ({ ...t, [k]: !t[k] }))} /> {k}s</label>
        ))}
        <span className="text-muted-foreground">click a provider to show or hide its members</span>
      </div>
      <div className="relative">
        <div ref={box} className="panel h-[22rem] w-full overflow-hidden" role="img" aria-label={`Network graph with ${q.data.nodes.length} nodes and ${q.data.edges.length} links`} />
        <p className="eyebrow pointer-events-none absolute bottom-2 left-3">scroll to zoom · drag to pan · hover to trace · derived links, not confirmed relationships</p>
      </div>
      <p className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span><span className="text-[var(--chart-1)]">●</span> provider</span>
        <span><span className="text-[var(--chart-2)]">◆</span> owner</span>
        <span><span className="text-[var(--chart-5)]">●</span> member</span>
        <span>red ring = primary provider; click a node for its links</span>
      </p>
      {node && (
        <div role="status" className="panel space-y-1 p-3 text-sm">
          <p>
            <strong className="mono">{node.id}</strong> · {node.type}{node.specialty ? ` · ${node.specialty}` : ''}{node.role ? ` · ${node.role.toLowerCase()}` : ''}
          </p>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {links.map((e) => <li key={e.id}>{e.source} → {e.target}: {e.label}</li>)}
          </ul>
        </div>
      )}
      <details className="text-sm">
        <summary className="eyebrow cursor-pointer">Links as a list ({q.data.edges.length})</summary>
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          {q.data.edges.map((e) => (
            <li key={e.id}>{e.source} → {e.target}: {e.label}{e.nClaims ? ` (${e.nClaims} claims)` : ''}</li>
          ))}
        </ul>
      </details>
    </div>
  )
}
