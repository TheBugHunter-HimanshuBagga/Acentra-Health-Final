import { useQuery } from '@tanstack/react-query'
import { Mic, MessageCircle, Send, Square, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import { useMe } from '@/lib/auth'
import type { ChatReply, Health } from '@/lib/types2'

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

  const health = useQuery<Health>({ queryKey: ['health'], queryFn: () => api('/api/health'), enabled: open && !!me, staleTime: 30_000 })
  const voiceOn = health.data?.voice === 'ON'
  const lang = me?.language ?? 'en'
  const caseId = /^\/cases\/([A-Za-z0-9-]+)/.exec(loc.pathname)?.[1]

  useEffect(() => end.current?.scrollIntoView?.({ block: 'end' }), [turns, open])
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current) }, [])

  function add(t: Omit<Turn, 'id'>) {
    idSeq.current += 1
    setTurns((all) => [...all, { ...t, id: idSeq.current }])
  }

  async function send(message: string) {
    const q = message.trim()
    if (!q || busy) return
    setText('')
    setConfirm(null)
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
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105"
      >
        {open ? <X aria-hidden className="h-5 w-5" /> : <MessageCircle aria-hidden className="h-5 w-5" />}
      </button>
      {open && (
        <section
          role="dialog"
          aria-label={t('chat.title')}
          className="surface fixed bottom-20 right-5 z-40 flex h-[min(34rem,calc(100vh-7rem))] w-[min(26rem,calc(100vw-2.5rem))] flex-col shadow-2xl"
        >
          <header className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="text-sm font-semibold">{t('chat.title')}</h2>
            <span className="text-xs text-muted-foreground">
              {health.data ? `AI: ${health.data.llm.toLowerCase()} · voice: ${health.data.voice.toLowerCase()}` : ''}
            </span>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
            {turns.length === 0 && <p className="text-sm text-muted-foreground">{t('chat.disclaimer')}</p>}
            {turns.map((m) =>
              m.role === 'you' ? (
                <p key={m.id} className="ml-8 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">{m.text}</p>
              ) : (
                <AssistantTurn key={m.id} turn={m} onNavigate={() => setOpen(false)} />
              ),
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

function AssistantTurn({ turn, onNavigate }: { turn: Turn; onNavigate: () => void }) {
  if (turn.error) return <p role="alert" className="mr-8 rounded-lg border border-destructive/40 px-3 py-2 text-sm">{turn.error}</p>
  const r = turn.reply!
  return (
    <div className="mr-8 space-y-2 rounded-lg border bg-card px-3 py-2 text-sm">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{r.label}</p>
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
            <p className="mono text-[11px] text-muted-foreground">Sources: {b.sourceIds.join(', ')}</p>
          )}
        </div>
      ))}
      {r.notices.map((n) => (
        <p key={n} className="text-xs text-muted-foreground">{NOTICES[n] ?? n}</p>
      ))}
      {r.links.map((l) => (
        <Link key={l.id} className="block text-xs underline" to={`/cases/${l.id}`} onClick={onNavigate}>
          Open {l.id}
        </Link>
      ))}
    </div>
  )
}
