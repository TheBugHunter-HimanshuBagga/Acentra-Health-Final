import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { me, mockFetch, renderWithProviders } from '@/test/utils'
import { LabPage } from './Lab'

const report = {
  basis: 'synthetic ground truth injected by the generator; not evidence of real-world detection power',
  coverage: { pct: 0.55, dollarsInCapacityCases: 218020, positiveDollars: 398313.6 },
  notes: ['Recall is exact; precision is a lower bound.'],
  decoys: { falselyFlagged: 0, lines: 8 },
  decoyProviders: [{ type: 'D1', scheme: 'S1', bestTier: 'MEDIUM', reachedHigh: false, providers: ['P-0070'] }, { type: 'D2', scheme: 'S2', bestTier: null, reachedHigh: false, providers: ['P-0071'] }],
  network: { casesPerRing: 1, ringRecovered: true, ringProviders: ['P-0001', 'P-0002'] },
  rules: [
    { rule: 'R-DOD-01', channel: 'LINE', flagged: 24, positives: 24, truePositives: 24, recall: 1, precisionLowerBound: 1 },
    { rule: 'S-UPC', channel: 'PEER', flagged: 90, positives: 40, truePositives: 38, recall: 0.95, precisionLowerBound: 0.42 },
  ],
  temporal: { detected: 5, schemeProviders: 20, medianDelayMonths: 1, falseAlarmsPer1000ProviderMonths: 3.98 },
  prediction: {
    available: true, model: 'hgb', notes: [], split: {}, features: [],
    horizons: {
      '30': { chosen: 'hgb', test: { beatsPersistence: true, metrics: { model: { prAuc: 0.49, rocAuc: 0.65, precisionAtTopDecile: 0.5, prevalence: 0.38 }, persistence_last_month: { prAuc: 0.47 } } }, positives: {}, rows: { test: 100 }, importance: [{ feature: 'hits_180', importance: 0.099, label: 'rule hits in 180 days' }] },
      '90': { chosen: 'logreg', test: { beatsPersistence: false, metrics: { model: { prAuc: 0.5 } } }, positives: {}, rows: { test: 100 }, importance: [] },
    },
  },
}

describe('The Lab', () => {
  it('shows each detector against synthetic ground truth and the outlook horizons, with the basis stated', async () => {
    mockFetch({ 'GET /api/auth/me': me(), 'GET /api/eval': report })
    renderWithProviders(<LabPage />)
    expect(await screen.findByText(/not evidence of real-world detection power/)).toBeInTheDocument()
    expect(screen.getByText('Services after death')).toBeInTheDocument()
    expect(screen.getByText('not flagged')).toBeInTheDocument()
    expect(screen.getByText('Visit levels above peers')).toBeInTheDocument()
    expect(screen.getByText('rule hits in 180 days')).toBeInTheDocument()
    expect(screen.getByText(/beats persistence/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: '90 days' }))
    expect(screen.getByText(/does not beat persistence/)).toBeInTheDocument()
  })
})
