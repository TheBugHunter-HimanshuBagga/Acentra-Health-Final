import { useQuery } from '@tanstack/react-query'
import { RateAI } from '@/features/review/RateAI'
import { Mic, MessageCircle, Send, Square, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import { useMe } from '@/lib/auth'
import type { ChatReply, Handoff, HandoffMessage, Health } from '@/lib/types2'

const MAX_SECONDS = 28

const NOTICES: Record<string, string> = {
  SHOWN_IN_ENGLISH: 'Some sentences are shown in English because a translation could not be checked.',
  TRANSLATION_UNAVAILABLE: 'Translation is unavailable right now, so this answer is in English.',
  VOICE_UNAVAILABLE: 'Spoken answers are unavailable right now.',
}

interface Turn {
  id: number
  role: 'you' | 'assistant'
  text?: string
  reply?: ChatReply
  error?: string
}

function playBase64(audio: { mimeType: string; base64: string }) {
  const el = new Audio(`data:${audio.mimeType};base64,${audio.base64}`)
  void el.play().catch(() => undefined)
}

/** The assistant: typed or spoken questions, answered from validated platform facts only. Floating, available on every page. */
export function ChatDock() {
  const { t } = useTranslation()
  const me = useMe().data
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>()
  const [speak, setSpeak] = useState(false)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<number | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const idSeq = useRef(0)
  const [handoff, setHandoff] = useState<Pick<Handoff, 'handoffId' | 'status' | 'agent'> | null>(null)
  const [hmsgs, setHmsgs] = useState<HandoffMessage[]>([])

  const health = useQuery<Health>({ queryKey: ['health'], queryFn: () => api('/api/health'), enabled: open && !!me, staleTime: 30_000 })
  const voiceOn = health.data?.voice === 'ON'
  const lang = me?.language ?? 'en'
  const caseId = /^\/cases\/([A-Za-z0-9-]+)/.exec(loc.pathname)?.[1]

  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [turns, hmsgs, open])

  // an open human handoff survives closing the panel or reloading the page
  useEffect(() => {
    if (!open || !me) return
    void api<{ active: boolean; handoff?: Handoff; messages?: HandoffMessage[] }>('/api/handoff/mine')
      .then((r) => {
        if (r.active && r.handoff) {
          setHandoff({ handoffId: r.handoff.handoffId, status: r.handoff.status, agent: r.handoff.agent })
          setHmsgs(r.messages ?? [])
        }
      })
      .catch(() => undefined)
  }, [open, me])

  // live updates from the specialist (server-sent events; the browser reconnects by itself)
  const hid = handoff?.handoffId
  useEffect(() => {
    if (!hid || typeof EventSource === 'undefined') return
    const es = new EventSource(`/api/handoff/${hid}/stream`)
    es.addEventListener('message', (ev) => {
      const m = JSON.parse((ev as MessageEvent).data) as HandoffMessage
      setHmsgs((all) => (all.some((x) => x.seq === m.seq) ? all : [...all, m]))
    })
    es.addEventListener('status', (ev) => {
      const st = JSON.parse((ev as MessageEvent).data) as { status: Handoff['status']; agent: string | null }
      setHandoff((h) => (h ? { ...h, status: st.status, agent: st.agent } : h))
      if (st.status === 'CLOSED') es.close()
    })
    return () => es.close()
  }, [hid])

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current) }, [])
  useEffect(() => {
    const o = () => setOpen(true)
    window.addEventListener('claimshield:open-chat', o)
    return () => window.removeEventListener('claimshield:open-chat', o)
  }, [])

  function add(t: Omit<Turn, 'id'>) {
    idSeq.current += 1
    setTurns((all) => [...all, { ...t, id: idSeq.current }])
  }

  async function connect() {
    setBusy(true)
    try {
      const r = await api<{ active: boolean; handoff?: Handoff; messages?: HandoffMessage[] }>('/api/handoff', {
        method: 'POST',
        body: { sessionId, reason: turns.filter((x) => x.role === 'you').at(-1)?.text ?? 'Requested from the assistant', caseId },
      })
      if (r.handoff) {
        setHandoff({ handoffId: r.handoff.handoffId, status: r.handoff.status, agent: r.handoff.agent })
        setHmsgs(r.messages ?? [])
      }
    } catch (e) {
      add({ role: 'assistant', error: e instanceof ApiError ? e.detail : t('common.error') })
    } finally {
      setBusy(false)
    }
  }

  async function send(message: string) {
    const q = message.trim()
    if (!q || busy) return
    setText('')
    setConfirm(null)
    if (handoff && handoff.status !== 'CLOSED') {
      setBusy(true)
      try {
        await api(`/api/handoff/${handoff.handoffId}/messages`, { method: 'POST', body: { text: q } })
        const r = await api<{ messages: HandoffMessage[] }>(`/api/handoff/${handoff.handoffId}?after=0`)
        setHmsgs(r.messages)
      } catch (e) {
        add({ role: 'assistant', error: e instanceof ApiError ? e.detail : t('common.error') })
        setText(q)
      } finally {
        setBusy(false)
      }
      return
    }
    add({ role: 'you', text: q })
    setBusy(true)
    try {
      const r = await api<ChatReply>('/api/chat', {
        method: 'POST',
        body: { sessionId, message: q, lang, speak, context: { page: caseId ? 'case' : loc.pathname.slice(1) || 'dashboard', caseId, horizon: 90 } },
      })
      setSessionId(r.sessionId)
      add({ role: 'assistant', reply: r })
      if (r.audio) playBase64(r.audio)
    } catch (e) {
      add({ role: 'assistant', error: e instanceof ApiError ? e.detail : t('common.error') })
    } finally {
      setBusy(false)
    }
  }

  async function startRecording() {
    setVoiceError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunks.current = []
      rec.ondataavailable = (e) => chunks.current.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop())
        void transcribe(new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' }))
      }
      rec.start()
      recorder.current = rec
      setRecording(true)
      setSeconds(0)
      timer.current = window.setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stopRecording()
          return s + 1
        })
      }, 1000)
    } catch {
      setVoiceError('The microphone is not available. Please type your question.')
    }
  }

  function stopRecording() {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
    setRecording(false)
  }

  async function transcribe(blob: Blob) {
    setBusy(true)
    try {
      const form = new FormData()
      form.append('audio', blob, blob.type.includes('wav') ? 'q.wav' : 'q.webm')
      form.append('language', lang)
      const r = await api<{ transcript: string; needsConfirmation: boolean }>('/api/voice/transcribe', { method: 'POST', form })
      setText(r.transcript)
      setConfirm(t('chat.confirm'))
    } catch (e) {
      setVoiceError(e instanceof ApiError ? e.detail : 'Voice is unavailable right now, please type your question.')
    } finally {
      setBusy(false)
    }
  }

  if (!me) return null
  return (
    <>
      <button
        type="button"
        aria-label={t('nav.askAssistant')}
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_30px_-6px_var(--glow)] ring-1 ring-white/20 hover:-translate-y-0.5"
      >
        {open ? <X aria-hidden className="h-5 w-5" /> : <MessageCircle aria-hidden className="h-5 w-5" />}
      </button>
      {open && (
        <section
          role="dialog"
          aria-label={t('chat.title')}
          className="glass fixed bottom-20 right-5 z-40 flex h-[min(36rem,calc(100vh-7rem))] w-[min(27rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl shadow-2xl"
        >
          <header className="space-y-1.5 border-b px-4 py-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t('chat.title')}</h2>
              <span className="mono text-[0.65rem] text-muted-foreground">
                {health.data ? `ai ${health.data.llm.toLowerCase()} · voice ${health.data.voice.toLowerCase()}` : ''}
              </span>
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="live-dot" aria-hidden /> {t('chat.grounded')}
            </p>
            <p className="eyebrow">{t('chat.context')}: <span className="text-foreground">{caseId ?? t('chat.noContext')}</span></p>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
            {turns.length === 0 && <p className="text-sm text-muted-foreground">{t('chat.disclaimer')}</p>}
            {turns.map((m) =>
              m.role === 'you' ? (
                <p key={m.id} className="ml-10 rounded-xl rounded-br-sm border bg-muted px-3 py-2 text-sm">{m.text}</p>
              ) : (
                <AssistantTurn key={m.id} turn={m} onNavigate={() => setOpen(false)} onConnect={() => void connect()} canConnect={!handoff} />
              ),
            )}
            {handoff && (
              <div className="space-y-2" aria-label="Human specialist conversation">
                <p className="eyebrow flex items-center gap-2 border-t pt-3">
                  <span className="live-dot" aria-hidden />
                  {handoff.status === 'WAITING' ? 'Waiting for a human specialist' : handoff.status === 'ACTIVE' ? `Connected to ${handoff.agent ?? 'a specialist'}` : 'Conversation closed'}
                </p>
                {hmsgs.map((m) => (
                  <p key={m.seq} className={m.role === 'USER' ? 'ml-10 rounded-xl rounded-br-sm border bg-muted px-3 py-2 text-sm' : m.role === 'AGENT' ? 'mr-6 border-l-2 border-[var(--ok)] py-1 pl-3 text-sm' : 'text-center text-xs text-muted-foreground'}>
                    {m.role === 'AGENT' && <span className="eyebrow mr-2">{m.sender}</span>}{m.text}
                  </p>
                ))}
                {handoff.status !== 'CLOSED' && (
                  <button type="button" className="text-xs underline" onClick={() => void api(`/api/handoff/${handoff.handoffId}/close`, { method: 'POST' }).then(() => setHandoff((h) => (h ? { ...h, status: 'CLOSED' } : h)))}>End the conversation with the specialist</button>
                )}
              </div>
            )}
            {busy && <p className="text-sm text-muted-foreground">{t('common.loading')}…</p>}
            <div ref={end} />
          </div>
          {(voiceError || confirm) && (
            <p role={voiceError ? 'alert' : 'status'} className="px-3 pb-1 text-xs text-muted-foreground">{voiceError ?? confirm}</p>
          )}
          <form
            className="flex items-center gap-2 border-t p-2"
            onSubmit={(e) => {
              e.preventDefault()
              void send(text)
            }}
          >
            <label className="sr-only" htmlFor="chat-input">{t('chat.placeholder')}</label>
            <input
              id="chat-input"
              value={text}
              maxLength={600}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('chat.placeholder')}
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
            />
            <Button
              type="button"
              variant={recording ? 'destructive' : 'outline'}
              size="icon"
              aria-label={recording ? t('chat.stop') : t('chat.mic')}
              disabled={busy || (!recording && health.data !== undefined && !voiceOn)}
              title={health.data && !voiceOn ? 'Voice is unavailable right now' : undefined}
              onClick={() => (recording ? stopRecording() : void startRecording())}
            >
              {recording ? <Square aria-hidden className="h-4 w-4" /> : <Mic aria-hidden className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant={speak ? 'secondary' : 'ghost'}
              size="icon"
              aria-pressed={speak}
              aria-label="Read answers aloud"
              disabled={!voiceOn}
              onClick={() => setSpeak((s) => !s)}
            >
              <Volume2 aria-hidden className="h-4 w-4" />
            </Button>
            <Button type="submit" size="icon" aria-label={t('chat.send')} disabled={busy || !text.trim()}>
              <Send aria-hidden className="h-4 w-4" />
            </Button>
          </form>
          {recording && <p className="px-3 pb-2 text-xs" role="status">{t('chat.listening')} {seconds}s / {MAX_SECONDS}s</p>}
        </section>
      )}
    </>
  )
}

function AssistantTurn({ turn, onNavigate, onConnect, canConnect }: { turn: Turn; onNavigate: () => void; onConnect: () => void; canConnect: boolean }) {
  if (turn.error) return <p role="alert" className="mr-8 rounded-lg border border-destructive/40 px-3 py-2 text-sm">{turn.error}</p>
  const r = turn.reply!
  return (
    <div className={`mr-6 space-y-2 border-l-2 py-1 pl-3 text-sm ${r.mode === 'REFUSAL' ? 'border-[var(--warn)]' : 'border-[var(--signal)]'}`}>
      <p className={`chip ${r.mode === 'REFUSAL' ? 'chip-corr' : 'chip-fact'}`}>{r.label}</p>
      {r.blocks.map((b, i) => (
        <div key={i} className="space-y-1">
          <p>{b.text}</p>
          {b.translated && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">English original</summary>
              {b.textEn}
            </details>
          )}
          {b.sourceIds.length > 0 && (
            <p className="mono flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">Sources: {b.sourceIds.map((id) => <span key={id} className="rounded border px-1.5 py-0.5">{id}</span>)}</p>
          )}
        </div>
      ))}
      {r.notices.map((n) => (
        <p key={n} className="text-xs text-muted-foreground">{NOTICES[n] ?? n}</p>
      ))}
      {r.mode !== 'REFUSAL' && <RateAI kind="CHAT" subject={String(turn.id)} text={r.blocks.map((b) => b.text).join(' ')} />}
      {r.handoffOffered && canConnect && (
        <button type="button" onClick={onConnect} className="rounded-full border px-3 py-1.5 text-xs hover:border-primary">Connect me to a human specialist</button>
      )}
      {r.links.map((l) => (
        <Link key={l.id} className="block text-xs underline" to={`/cases/${l.id}`} onClick={onNavigate}>
          Open {l.id}
        </Link>
      ))}
    </div>
  )
}
