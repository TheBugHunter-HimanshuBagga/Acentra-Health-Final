import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import { api } from '@/lib/api'
import type { QueueResponse } from '@/lib/types'

const PAGES: [string, string][] = [
  ['Dashboard', '/'],
  ['SIU queue', '/queue'],
  ['Investigation canvas', '/investigate'],
  ['The Lab', '/lab'],
  ['Precedents', '/precedents'],
  ['Rules and exceptions', '/governance'],
  ['Audit trail', '/audit'],
  ['Library', '/library'],
]

/** Ctrl/Cmd+K: jump to a page, open any case in the current queue, or ask the assistant. Real queue data, no demo list. */
export function CommandPalette({ onToggleTheme, showAgent }: { onToggleTheme: () => void; showAgent: boolean }) {
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const queue = useQuery<QueueResponse>({ queryKey: ['palette-queue'], queryFn: () => api('/api/queue?horizon=90&capacityHours=1000'), enabled: open, staleTime: 60_000, retry: false })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const go = (to: string) => {
    setOpen(false)
    nav(to)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to a page, a case, or an action">
      <Command>
        <CommandInput placeholder="Search pages, cases, providers, actions" aria-label="Search pages, cases, providers, actions" />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          <CommandGroup heading="Pages">
            {[...PAGES, ...(showAgent ? ([['Messages', '/agent']] as [string, string][]) : [])].map(([label, to]) => (
              <CommandItem key={to} value={`page ${label}`} onSelect={() => go(to)}>{label}</CommandItem>
            ))}
          </CommandGroup>
          {queue.data && (
            <CommandGroup heading="Cases">
              {queue.data.items.map((i) => (
                <CommandItem key={i.caseId} value={`case ${i.caseId} ${i.subjects.map((s) => s.id).join(' ')} ${i.hypotheses.join(' ')} ${i.tier}`} onSelect={() => go(`/cases/${i.caseId}`)}>
                  <span className="mono text-xs">{i.caseId}</span>
                  <span className="text-muted-foreground">{i.subjects.map((s) => s.id).join(', ')} · {i.hypotheses.join(', ')}</span>
                  <CommandShortcut>{i.tier}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading="Actions">
            <CommandItem value="action ask the assistant" onSelect={() => { setOpen(false); window.dispatchEvent(new Event('claimshield:open-chat')) }}>Ask the assistant</CommandItem>
            <CommandItem value="action toggle theme dark light" onSelect={() => { setOpen(false); onToggleTheme() }}>Switch between dark and light</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
