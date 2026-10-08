import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'claimshield-theme'

function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'dark' || v === 'light') return v
  } catch {
    /* private mode */
  }
  return 'dark'
}

function paint(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

/** Applies the saved theme before first paint (called from main.tsx) so there is no flash. */
export function initTheme() {
  paint(stored())
}

type Transition = { ready: Promise<void>; finished: Promise<void> }

/**
 * Theme with a persisted preference. Switching reveals the new theme as a circle expanding from the toggle
 * (View Transitions API); browsers without it, and reduced-motion users, get a short colour fade instead.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(stored)
  useEffect(() => paint(theme), [theme])

  const toggle = useCallback(
    (origin?: HTMLElement | null) => {
      const next: Theme = theme === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(KEY, next)
      } catch {
        /* the choice just is not remembered */
      }
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      const doc = document as Document & { startViewTransition?: (cb: () => void) => Transition }
      if (origin && doc.startViewTransition && !reduce) {
        const r = origin.getBoundingClientRect()
        document.documentElement.style.setProperty('--tx', `${r.left + r.width / 2}px`)
        document.documentElement.style.setProperty('--ty', `${r.top + r.height / 2}px`)
        doc.startViewTransition(() => {
          paint(next)
          setTheme(next)
        })
        return
      }
      const root = document.documentElement
      if (!reduce) {
        root.classList.add('theme-fade')
        window.setTimeout(() => root.classList.remove('theme-fade'), 500)
      }
      paint(next)
      setTheme(next)
    },
    [theme],
  )

  return { theme, toggle }
}
