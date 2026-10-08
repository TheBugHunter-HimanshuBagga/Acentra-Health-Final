import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { setUiLanguage } from '@/i18n'
import { Aurora, Reveal } from '@/lib/motion'
import { ApiError } from '@/lib/api'
import { useMe, useSavePrefs } from '@/lib/auth'
import { LANGUAGES, type LangCode } from '@/lib/types2'

/** First sign-in: choose a language (applies to the interface and the assistant). It can be skipped and changed later. */
export function OnboardingPage() {
  const { t } = useTranslation()
  const me = useMe().data
  const save = useSavePrefs()
  const navigate = useNavigate()
  const [choice, setChoice] = useState<LangCode>((me?.language as LangCode) || 'en')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!me) return null
  if (me.onboarded || me.onboardingSkipped) return <Navigate to="/" replace />

  async function done(skip: boolean) {
    setBusy(true)
    setError(null)
    try {
      await save({ language: skip ? 'en' : choice, onboarded: !skip, onboardingSkipped: skip })
      navigate('/')
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[oklch(0.18_0.04_270)] text-white"><Aurora />
    <main className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 p-6">
      <header className="space-y-2">
        <p className="text-sm font-medium text-primary">ClaimShield Nexus</p>
        <h1 className="bg-gradient-to-r from-white to-teal-200 bg-clip-text text-4xl font-semibold tracking-tight text-transparent">{t('onboarding.title')}</h1>
        <p className="text-white/70">{t('onboarding.subtitle')}</p>
      </header>
      <Reveal className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            role="radio"
            aria-checked={choice === l.code}
            onClick={() => {
              setChoice(l.code)
              setUiLanguage(l.code)
            }}
            className={`rounded-xl border border-white/15 bg-white/10 p-4 text-left backdrop-blur transition hover:-translate-y-1 hover:bg-white/20 ${choice === l.code ? 'border-teal-300 bg-white/20 ring-2 ring-teal-300/50' : ''}`}
          >
            <span className="block text-lg font-medium">{l.native}</span>
            <span className="text-xs text-white/60">{l.english}</span>
          </button>
        ))}
      </Reveal>
      <p className="text-sm text-white/60">{t('onboarding.note')}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-3">
        <Button onClick={() => void done(false)} disabled={busy}>{t('onboarding.continue')}</Button>
        <Button variant="ghost" onClick={() => void done(true)} disabled={busy}>{t('onboarding.skip')}</Button>
      </div>
    </main>
    </div>
  )
}
