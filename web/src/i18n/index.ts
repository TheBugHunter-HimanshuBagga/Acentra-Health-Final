import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './ui.en.json'
import others from './ui.others.json'
import type { LangCode } from '@/lib/types2'

// Interface text is translated at build time (scripts/translate-json.mjs) and reviewed by a person; evidence,
// policy and claim text are never translated in the interface so every figure stays checkable.
const resources: Record<string, { translation: Record<string, unknown> }> = { en: { translation: en } }
for (const [code, tr] of Object.entries(others as Record<string, unknown>)) resources[code] = { translation: tr as Record<string, unknown> }

void i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
})

/** Switch the interface language and the document language/font hints. */
export function setUiLanguage(code: LangCode | string) {
  const lng = code in resources ? code : 'en'
  void i18n.changeLanguage(lng)
  document.documentElement.lang = lng === 'od' ? 'or' : lng
}

export default i18n
