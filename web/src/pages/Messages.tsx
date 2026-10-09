// Messages: direct conversations between two people, with a case attachable to any message. It is deliberately separate
// from the assistant chat. Specialists also get a second tab with the requests that came from the assistant.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessagesSquare, Paperclip, Plus, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/kit/section'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import { useMe } from '@/lib/auth'
import { HandoffDesk } from './Agent'

interface Person { username: string; displayName: string; role: string }
interface ThreadRow { threadId: string; with: Person; unread: number; updatedAt: string; last: { sender: string; text: string; caseId: string | null; at: string } | null }
interface DmMessage { seq: number; sender: string; text: string; caseId: string | null; at: string; mine: boolean }
interface DmThread { threadId: string; with: Person; messages: DmMessage[] }

const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const when = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function Avatar({ p, size = 36 }: { p: Person; size?: number }) {
  return <span aria-hidden className="grid shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--chart-2)_18%,transparent)] text-xs font-semibold" style={{ width: size, height: size }}>{initials(p.displayName)}</span>
}

function CaseCard({ caseId }: { caseId: string }) {
  return (
    <div className="mt-1.5 flex items-center gap-3 rounded-xl border bg-background/80 p-2.5 text-xs text-foreground">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-muted"><Paperclip aria-hidden className="h-3.5 w-3.5" /></span>
      <span className="min-w-0 flex-1"><span className="eyebrow !text-[0.58rem]">Attached case</span><br /><span className="mono font-semibold">{caseId}</span></span>
      <Link className="rounded-full border px-2.5 py-1 hover:bg-muted" to={`/cases/${caseId}`}>Workspace</Link>
      <Link className="rounded-full border px-2.5 py-1 hover:bg-muted" to={`/investigate/${caseId}`}>Canvas</Link>
    </div>
  )
}

function Conversations() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const sel = params.get('thread')
  const [composing, setComposing] = useState(false)
  const [to, setTo] = useState('')
  const [caseId, setCaseId] = useState('')
  const [text, setText] = useState('')
  const [reply, setReply] = useState('')
  const [attach, setAttach] = useState('')
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const people = useQuery<Person[]>({ queryKey: ['people'], queryFn: () => api('/api/people'), staleTime: 60_000 })
  const cases = useQuery<{ items: { caseId: string; tier: string }[] }>({ queryKey: ['dm-cases'], queryFn: () => api('/api/queue?horizon=90&capacityHours=1000'), staleTime: 60_000 })
  const threads = useQuery<ThreadRow[]>({ queryKey: ['dm-threads'], queryFn: () => api('/api/dm/threads'), refetchInterval: 3000 })
  const open = useQuery<DmThread>({ queryKey: ['dm-thread', sel], queryFn: () => api(`/api/dm/threads/${sel}`), enabled: !!sel, refetchInterval: 2500 })
  const count = open.data?.messages.length ?? 0

  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [count, sel])
  useEffect(() => {          // opening a conversation reads it
    if (!sel || count === 0) return
    void api(`/api/dm/threads/${sel}/read`, { method: 'POST' })
      .then(() => Promise.all([qc.invalidateQueries({ queryKey: ['dm-threads'] }), qc.invalidateQueries({ queryKey: ['notifications'] })]))
      .catch(() => undefined)
  }, [sel, count, qc])

  const go = (id: string | null) => setParams(id ? { thread: id } : {}, { replace: true })
  const start = async () => {
    setError(null)
    try {
      const r = await api<{ threadId: string }>('/api/dm/threads', { method: 'POST', body: { to, caseId: caseId || null, text } })
      setComposing(false); setText(''); setCaseId(''); setTo('')
      await qc.invalidateQueries({ queryKey: ['dm-threads'] })
      go(r.threadId)
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'Could not start the conversation.')
    }
  }
  const send = async () => {
    if (!sel || !reply.trim()) return
    setError(null)
    try {
      await api(`/api/dm/threads/${sel}/messages`, { method: 'POST', body: { text: reply, caseId: attach || null } })
      setReply(''); setAttach('')
      await qc.invalidateQueries({ queryKey: ['dm-thread', sel] })
      await qc.invalidateQueries({ queryKey: ['dm-threads'] })
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'The message could not be sent.')
    }
  }
  const caseSelect = (v: string, set: (s: string) => void, id: string) => (
    <select id={id} aria-label="Attach a case" value={v} onChange={(e) => set(e.target.value)} className="h-9 max-w-[11rem] rounded-full border bg-transparent px-3 text-xs">
      <option value="">No case attached</option>
      {(cases.data?.items ?? []).map((c) => <option key={c.caseId} value={c.caseId}>{c.caseId} · {c.tier.toLowerCase()}</option>)}
    </select>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[21rem_1fr]">
      <div className="space-y-3">
        <Button className="w-full" onClick={() => setComposing((c) => !c)}><Plus aria-hidden className="h-4 w-4" /> New conversation</Button>
        {composing && (
          <form className="notif-pop space-y-2.5 rounded-2xl border bg-card p-3.5" onSubmit={(e) => { e.preventDefault(); void start() }} aria-label="New conversation">
            <label className="eyebrow block" htmlFor="dm-to">Who</label>
            <select id="dm-to" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-full rounded-full border bg-transparent px-3 text-sm">
              <option value="">Choose a person</option>
              {(people.data ?? []).map((p) => <option key={p.username} value={p.username}>{p.displayName} · {p.role.toLowerCase()}</option>)}
            </select>
            <label className="eyebrow block" htmlFor="dm-case">About a case (optional)</label>
            {caseSelect(caseId, setCaseId, 'dm-case')}
            <label className="eyebrow block" htmlFor="dm-text">Your message</label>
            <textarea id="dm-text" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Write your input on the case or ask a question" className="w-full rounded-xl border bg-transparent p-2.5 text-sm outline-none focus:border-[var(--signal)]" />
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <Button type="submit" size="sm" disabled={!to || !text.trim()}><Send aria-hidden className="h-3.5 w-3.5" /> Send</Button>
          </form>
        )}
        <ul aria-label="Conversations" className="divide-y overflow-hidden rounded-2xl border bg-card">
          {(threads.data ?? []).length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No conversations yet. Start one with a colleague and attach a case.</li>}
          {(threads.data ?? []).map((t) => (
            <li key={t.threadId}>
              <button type="button" onClick={() => go(t.threadId)} aria-current={t.threadId === sel} className={`flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-muted ${t.threadId === sel ? 'bg-muted/60' : ''}`}>
                <Avatar p={t.with} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{t.with.displayName}</span>{t.last && <span className="mono text-[0.6rem] text-muted-foreground">{when(t.last.at)}</span>}</span>
                  <span className="block truncate text-xs text-muted-foreground">{t.last ? `${t.last.caseId ? t.last.caseId + ' · ' : ''}${t.last.text}` : 'No messages yet'}</span>
                </span>
                {t.unread > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-[var(--tier-high)] px-1.5 text-[0.62rem] font-semibold leading-5 text-white" aria-label={`${t.unread} unread`}>{t.unread}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel flex min-h-[28rem] flex-col overflow-hidden !p-0" aria-label="Conversation">
        {!sel || !open.data ? (
          <div className="m-auto max-w-xs space-y-2 p-8 text-center">
            <MessagesSquare aria-hidden className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Pick a conversation or start a new one</p>
            <p className="text-xs text-muted-foreground">Direct messages are between you and one colleague. Attach a case to any message so they can open it and give input.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b px-4 py-3">
              <Avatar p={open.data.with} />
              <div className="min-w-0"><p className="truncate text-sm font-semibold">{open.data.with.displayName}</p><p className="eyebrow !text-[0.6rem]">{open.data.with.role.toLowerCase()}</p></div>
            </div>
            <div className="flex-1 space-y-2.5 overflow-y-auto p-4" aria-live="polite">
              {open.data.messages.map((m) => (
                <div key={m.seq} className={m.mine ? 'ml-auto max-w-[80%]' : 'mr-auto max-w-[80%]'}>
                  <div className={`rounded-2xl px-3.5 py-2 text-sm ${m.mine ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm border bg-card'}`}>
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    {m.caseId && <CaseCard caseId={m.caseId} />}
                  </div>
                  <p className={`mono mt-0.5 text-[0.58rem] text-muted-foreground ${m.mine ? 'text-right' : ''}`}>{when(m.at)}</p>
                </div>
              ))}
              <div ref={end} />
            </div>
            {error && <p role="alert" className="px-4 text-xs text-destructive">{error}</p>}
            <form className="flex flex-wrap items-center gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); void send() }}>
              {caseSelect(attach, setAttach, 'dm-attach')}
              <label className="sr-only" htmlFor="dm-reply">Message</label>
              <input id="dm-reply" value={reply} maxLength={1000} onChange={(e) => setReply(e.target.value)} placeholder="Write a message" className="h-9 min-w-[10rem] flex-1 rounded-full border bg-transparent px-4 text-sm outline-none focus:border-[var(--signal)]" />
              <Button type="submit" size="sm" disabled={!reply.trim()} aria-label="Send message"><Send aria-hidden className="h-3.5 w-3.5" /> Send</Button>
            </form>
            <p className="px-4 pb-2 text-[0.65rem] text-muted-foreground">Please do not share personal identifiers; use case and claim ids. Messages are recorded in the audit trail by hash.</p>
          </>
        )}
      </div>
    </div>
  )
}

export function AgentPage() {
  const me = useMe().data
  const [params, setParams] = useSearchParams()
  if (!me) return null
  if (me.role === 'AUDITOR') return <p className="text-sm text-muted-foreground">Messages are for investigators, supervisors and governance. Auditors read the audit trail.</p>
  const specialist = me.role === 'SUPERVISOR' || me.role === 'GOVERNANCE'
  const tab = params.get('tab') === 'assistant' || params.get('open') ? 'assistant' : 'messages'
  return (
    <section className="space-y-5">
      <PageHeader eyebrow="Colleagues" lead={null} accent="Messages" lede="Talk to a colleague directly, attach a case and give your input on it. This is separate from the assistant." />
      {specialist && (
        <div role="tablist" aria-label="Messages sections" className="flex gap-2 text-sm">
          <button role="tab" aria-selected={tab === 'messages'} onClick={() => setParams({}, { replace: true })} className={`rounded-full border px-4 py-1.5 transition ${tab === 'messages' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>Conversations</button>
          <button role="tab" aria-selected={tab === 'assistant'} onClick={() => setParams({ tab: 'assistant' }, { replace: true })} className={`rounded-full border px-4 py-1.5 transition ${tab === 'assistant' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>Assistant requests</button>
        </div>
      )}
      {tab === 'assistant' && specialist ? <HandoffDesk /> : <Conversations />}
    </section>
  )
}
