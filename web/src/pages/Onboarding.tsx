import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { setUiLanguage } from '@/i18n'
import { SignalField } from '@/components/SignalField'
import { Reveal } from '@/lib/motion'
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
    <div className="relative min-h-screen overflow-hidden bg-background"><div className="grid-bg absolute inset-0" aria-hidden /><SignalField />
    <main className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 p-6">
      <header className="space-y-2">
        <p className="eyebrow">ClaimShield Nexus</p>
        <h1 className="display text-5xl">{t('onboarding.title')}</h1>
        <p className="text-muted-foreground">{t('onboarding.subtitle')}</p>
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
            className={`glass rounded-xl p-4 text-left hover:-translate-y-1 hover:border-primary ${choice === l.code ? 'border-primary ring-2 ring-primary/40' : ''}`}
          >
            <span className="block text-lg font-medium">{l.native}</span>
            <span className="text-xs text-muted-foreground">{l.english}</span>
          </button>
        ))}
      </Reveal>
      <p className="text-sm text-muted-foreground">{t('onboarding.note')}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-3">
        <Button onClick={() => void done(false)} disabled={busy}>{t('onboarding.continue')}</Button>
        <Button variant="ghost" onClick={() => void done(true)} disabled={busy}>{t('onboarding.skip')}</Button>
      </div>
    </main>
    </div>
  )
}
