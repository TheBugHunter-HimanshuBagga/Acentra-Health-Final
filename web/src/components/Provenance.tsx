import { useTranslation } from 'react-i18next'

export type ProvKind = 'fact' | 'signal' | 'corroboration' | 'prediction' | 'human'

const CLASS: Record<ProvKind, string> = {
  fact: 'chip chip-fact',
  signal: 'chip chip-signal',
  corroboration: 'chip chip-corr',
  prediction: 'chip chip-pred',
  human: 'chip chip-human',
}

/** The five kinds of statement the product makes. A prediction is dashed and hatched so it can never read as proof. */
export function ProvChip({ kind }: { kind: ProvKind }) {
  const { t } = useTranslation()
  return <span className={CLASS[kind]}>{t(`prov.${kind}`)}</span>
}

const ORDER: ProvKind[] = ['fact', 'signal', 'corroboration', 'prediction', 'human']

export function ProvLegend() {
  const { t } = useTranslation()
  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="eyebrow cursor-pointer select-none list-none hover:text-foreground">
        {t('prov.legend')} <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
      </summary>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {ORDER.map((k) => (
          <li key={k} className="space-y-1">
            <ProvChip kind={k} />
            <p>{t(`prov.${k}Help`)}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}
