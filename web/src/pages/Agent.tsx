import { PageHeader } from '@/components/kit/section'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import { useMe } from '@/lib/auth'
import type { Handoff, HandoffMessage } from '@/lib/types2'

interface QueueItem extends Handoff {
  messageCount: number
  lastMessage: HandoffMessage | null
}

/** The specialist desk: people who asked for a human appear here; a supervisor or governance user joins in the same chat. */
export function AgentPage() {
  const me = useMe().data
  const qc = useQueryClient()
  const allowed = me?.role === 'SUPERVISOR' || me?.role === 'GOVERNANCE'
  const [params] = useSearchParams()
  const wanted = params.get('open')
  const [sel, setSel] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<HandoffMessage[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const queue = useQuery<{ items: QueueItem[] }>({
    queryKey: ['agent-queue'], queryFn: () => api('/api/agent/queue'), enabled: allowed, refetchInterval: 3000,
  })
  const current = queue.data?.items.find((i) => i.handoffId === sel)

  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [msgs])
  useEffect(() => {          // arriving from a notification: open that conversation if it is already yours
    const hit = queue.data?.items.find((i) => i.handoffId === wanted)
    if (hit && hit.status === 'ACTIVE') setSel(hit.handoffId)
  }, [wanted, queue.data])
  useEffect(() => {
    if (!sel || !current || current.status === 'WAITING') return
    void api<{ messages: HandoffMessage[] }>(`/api/handoff/${sel}`).then((r) => setMsgs(r.messages)).catch(() => undefined)
    if (typeof EventSource === 'undefined') return
    const es = new EventSource(`/api/handoff/${sel}/stream`)
    es.addEventListener('message', (ev) => {
      const m = JSON.parse((ev as MessageEvent).data) as HandoffMessage
      setMsgs((all) => (all.some((x) => x.seq === m.seq) ? all : [...all, m]))
    })
    return () => es.close()
  }, [sel, current?.status])

  if (!me) return null
  if (!allowed) return <p>The specialist desk is for supervisors and governance specialists.</p>

  async function join(id: string) {
    setError(null)
    try {
      const r = await api<{ messages: HandoffMessage[] }>(`/api/agent/handoffs/${id}/join`, { method: 'POST' })
      setMsgs(r.messages)
      setSel(id)
      void qc.invalidateQueries({ queryKey: ['agent-queue'] })
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'Could not join the conversation.')
    }
  }

  async function reply() {
    if (!sel || !text.trim()) return
    setError(null)
    try {
      await api(`/api/handoff/${sel}/messages`, { method: 'POST', body: { text } })
      setText('')
      const r = await api<{ messages: HandoffMessage[] }>(`/api/handoff/${sel}`)
      setMsgs(r.messages)
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'The reply could not be sent.')
    }
  }

  async function close() {
    if (!sel) return
    await api(`/api/handoff/${sel}/close`, { method: 'POST' })
    setSel(null)
    setMsgs([])
    void qc.invalidateQueries({ queryKey: ['agent-queue'] })
  }

  const items = queue.data?.items ?? []
  return (
    <section className="space-y-6">
      <header className="space-y-3">
        <PageHeader eyebrow="Human in the loop" lead="Specialist" accent="desk" inline lede="People land here when the assistant could not answer confidently or they asked for a person. Joining continues the same chat; every message is stored for the audit trail." />
      </header>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-2">
          <p className="eyebrow">Waiting and active ({items.length})</p>
          {items.length === 0 && <p className="text-sm text-muted-foreground">No one is waiting for a specialist.</p>}
          <ul className="divide-y border-y">
            {items.map((i) => (
              <li key={i.handoffId} className={`space-y-1 px-2 py-3 text-sm transition ${i.handoffId === sel ? 'bg-muted/50' : ''} ${i.handoffId === wanted && i.status === 'WAITING' ? 'bg-[color-mix(in_oklab,var(--signal)_10%,transparent)] ring-1 ring-[var(--signal)]' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="mono text-xs">{i.handoffId}</span>
                  <span className={`chip ${i.status === 'WAITING' ? 'chip-corr' : 'chip-fact'}`}>{i.status.toLowerCase()}</span>
                  <span className="text-muted-foreground">{i.requestedBy}</span>
                </div>
                <p className="text-xs text-muted-foreground">{i.reason}{i.caseId ? <> · <Link className="underline" to={`/cases/${i.caseId}`}>{i.caseId}</Link></> : null}</p>
                {i.status === 'WAITING' ? <Button size="sm" onClick={() => void join(i.handoffId)}>Join the conversation</Button> : <Button size="sm" variant="outline" onClick={() => setSel(i.handoffId)}>Open</Button>}
              </li>
            ))}
          </ul>
        </div>
        <div className="panel flex min-h-[24rem] flex-col p-4" aria-label="Conversation">
          {!current || !sel ? <p className="m-auto text-sm text-muted-foreground">Select a conversation.</p> : (
            <>
              <div className="flex items-center justify-between border-b pb-2">
                <p className="text-sm font-medium">{current.requestedBy} <span className="text-muted-foreground">· {current.status.toLowerCase()}</span></p>
                <Button size="sm" variant="outline" onClick={() => void close()}>Close</Button>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto py-3" aria-live="polite">
                {msgs.map((m) => (
                  <p key={m.seq} className={m.role === 'USER' ? 'mr-12 rounded-xl rounded-bl-sm border bg-muted px-3 py-2 text-sm' : m.role === 'AGENT' ? 'ml-12 rounded-xl rounded-br-sm border border-[var(--ok)] px-3 py-2 text-sm' : 'text-center text-xs text-muted-foreground'}>
                    <span className="eyebrow mr-2">{m.role === 'SYSTEM' ? '' : m.sender}</span>{m.text}<span className="mono ml-2 text-[0.6rem] text-muted-foreground">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </p>
                ))}
                <div ref={end} />
              </div>
              <form className="flex gap-2 border-t pt-3" onSubmit={(e) => { e.preventDefault(); void reply() }}>
                <label className="sr-only" htmlFor="agent-reply">Reply</label>
                <input id="agent-reply" className="h-9 flex-1 rounded-full border bg-transparent px-3 text-sm" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply in this chat" />
                <Button type="submit" size="sm" disabled={!text.trim()}>Send</Button>
              </form>
              <p className="pt-2 text-xs text-muted-foreground">Please do not ask for or share personal identifiers; use case and claim ids.</p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
