// A bell with an unread count, a short list, and a toast when something new arrives. Notifications are stored for the
// person, so someone who signs in later still sees what happened while they were away. Message text is never in them.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, MessageCircle, UserPlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'

interface Item { id: string; kind: string; title: string; body: string | null; link: string | null; count: number; createdAt: string; read: boolean }
interface Feed { unread: number; items: Item[] }
interface Toast { key: string; title: string; body: string | null; item?: Item }

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}

const ICON: Record<string, typeof Bell> = { HANDOFF_REQUESTED: UserPlus, HANDOFF_JOINED: MessageCircle, HANDOFF_MESSAGE: MessageCircle, HANDOFF_CLOSED: Check }

export function NotificationBell() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const seen = useRef<Map<string, number> | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const q = useQuery<Feed>({ queryKey: ['notifications'], queryFn: () => api('/api/notifications'), refetchInterval: 4000, refetchIntervalInBackground: true })
  const read = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => api<Feed>('/api/notifications/read', { method: 'POST', body }),
    onSuccess: (f) => qc.setQueryData(['notifications'], f),
  })

  useEffect(() => {          // toasts: the sign-in summary once, then anything that is new or has grown
    const f = q.data
    if (!f) return
    const unread = f.items.filter((i) => !i.read)
    if (seen.current === null) {
      seen.current = new Map(unread.map((i) => [i.id, i.count]))
      if (f.unread > 0) setToasts([{ key: 'welcome', title: `You have ${f.unread} unread notification${f.unread === 1 ? '' : 's'}`, body: unread[0]?.title ?? null, item: unread[0] }])
      return
    }
    const fresh = unread.filter((i) => (seen.current!.get(i.id) ?? 0) < i.count)
    unread.forEach((i) => seen.current!.set(i.id, i.count))
    if (fresh.length) setToasts((t) => [...t, ...fresh.map((i) => ({ key: `${i.id}-${i.count}`, title: i.title, body: i.body, item: i }))].slice(-3))
  }, [q.data])

  useEffect(() => {
    if (toasts.length === 0) return
    const id = window.setTimeout(() => setToasts((t) => t.slice(1)), 7000)
    return () => window.clearTimeout(id)
  }, [toasts])

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  const go = (i: Item) => {
    read.mutate({ ids: [i.id] })
    setOpen(false)
    setToasts([])
    if (!i.link) return
    if (i.link.startsWith('chat:')) window.dispatchEvent(new Event('claimshield:open-chat'))
    else nav(i.link)
  }
  const unread = q.data?.unread ?? 0

  return (
    <div ref={box} className="relative">
      <button type="button" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="relative grid h-8 w-8 place-items-center rounded-full border transition hover:border-primary active:scale-95">
        <Bell aria-hidden className={`h-4 w-4 ${unread ? 'bell-ring' : ''}`} />
        {unread > 0 && <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-[var(--tier-high)] px-1 text-[0.6rem] font-semibold leading-4 text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" className="notif-pop absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-2xl border bg-popover shadow-2xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <button type="button" disabled={unread === 0} onClick={() => read.mutate({ all: true })} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:no-underline disabled:opacity-40">Mark all read</button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {(q.data?.items ?? []).length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing yet. Requests and replies appear here.</li>}
            {(q.data?.items ?? []).map((i) => {
              const Icon = ICON[i.kind] ?? Bell
              return (
                <li key={i.id}>
                  <button type="button" onClick={() => go(i)} className={`flex w-full gap-3 border-b px-4 py-3 text-left transition last:border-b-0 hover:bg-muted ${i.read ? 'opacity-60' : ''}`}>
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted"><Icon aria-hidden className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2"><span className="truncate text-[13px] font-medium">{i.title}</span>{i.count > 1 && <span className="mono rounded-full border px-1.5 text-[0.6rem]">×{i.count}</span>}</span>
                      {i.body && <span className="block truncate text-xs text-muted-foreground">{i.body}</span>}
                      <span className="mono text-[0.62rem] text-muted-foreground">{ago(i.createdAt)}</span>
                    </span>
                    {!i.read && <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--signal)]" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div aria-live="polite" className="pointer-events-none fixed bottom-5 left-5 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.key} className="toast-in pointer-events-auto flex items-start gap-3 rounded-2xl border bg-popover p-3.5 shadow-2xl">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--signal)] text-[var(--accent-foreground)]"><Bell aria-hidden className="h-4 w-4" /></span>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => t.item ? go(t.item) : setToasts((x) => x.filter((y) => y.key !== t.key))}>
              <p className="text-[13px] font-medium">{t.title}</p>
              {t.body && <p className="truncate text-xs text-muted-foreground">{t.body}</p>}
              <p className="mt-1 text-[0.65rem] text-muted-foreground">Click to open</p>
            </button>
            <button type="button" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.key !== t.key))} className="text-muted-foreground hover:text-foreground"><X aria-hidden className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
