import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Brief } from '@/lib/types'
import { me, mockFetch, renderWithProviders } from '@/test/utils'
import { BriefPanel } from './BriefPanel'

const TITLES = [
  '1. Evidence',
  '2. Timeline',
  '3. Network context',
  '4. Confidence',
  '5. Limitations',
  '6. Recommended human-review action',
  '7. Supporting case and risk context',
]

const brief = (over: Partial<Brief> = {}): Brief => ({
  briefId: 'BRF-00001',
  caseId: 'CASE-0001',
  mode: 'TEMPLATE',
  badge: 'VALIDATED',
  generatedAt: '2026-10-08T09:53:12.427926500Z',
  packSha256: 'a'.repeat(64),
  model: null,
  sections: {
    headline: { text: 'Exact duplicate line: $2,232.80 in recorded amounts needs human review', cites: ['E1'] },
    hypothesis: 'DUP',
    recommendedAction: 'REQUEST_RECORDS',
    insufficientEvidence: false,
    markdown: '# Investigation brief',
    sections: TITLES.map((title, i) => ({
      key: `k${i}`,
      title,
      items: [{ text: `Line for ${title}`, cites: i === 4 ? ['L1'] : ['E1', 'T1'] }],
    })),
  },
  validation: {
    passed: true,
    retries: 0,
    fallbackReason: null,
    checks: [
      { id: 'V1', name: 'Schema and stop reason', severity: 'BLOCK', status: 'PASS', details: [] },
      { id: 'V14', name: 'No certainty language', severity: 'WARN', status: 'WARN', details: ['summary[0] uses x'] },
    ],
  },
  ...over,
})

describe('BriefPanel', () => {
  it('offers generation when no brief exists, then shows the seven elements with citations', async () => {
    const m = mockFetch({
      'GET /api/cases/CASE-0001/brief': { status: 204 },
      'POST /api/cases/CASE-0001/brief': brief(),
    })
    renderWithProviders(<BriefPanel caseId="CASE-0001" me={me()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Generate investigation brief' }))
    expect(await screen.findByTestId('brief-badge')).toHaveTextContent('Validated')
    for (const t of TITLES) {
      const sec = screen.getByRole('region', { name: t })
      expect(within(sec).getByText(/Line for/)).toBeInTheDocument()
    }
    expect(screen.getByText(/Exact duplicate line: \$2,232.80/)).toBeInTheDocument()
    expect(screen.getAllByLabelText('Evidence E1, T1').length).toBeGreaterThan(0)
    expect(screen.getByText(/15|2 checks/)).toBeInTheDocument()
    expect(m.callsTo('POST', '/api/cases/CASE-0001/brief')).toHaveLength(1)
  })

  it('shows a stored brief straight away, with the warning count', async () => {
    mockFetch({ 'GET /api/cases/CASE-0001/brief': brief() })
    renderWithProviders(<BriefPanel caseId="CASE-0001" me={me('AUDITOR')} />)
    expect(await screen.findByText(/Validation: passed · 2 checks · 1 warning/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate/ })).not.toBeInTheDocument()
  })

  it('labels a fallback brief and says why', async () => {
    mockFetch({
      'GET /api/cases/CASE-0001/brief': brief({
        badge: 'TEMPLATE_FALLBACK',
        validation: { passed: true, retries: 1, fallbackReason: 'validation failed: V5', checks: [] },
      }),
    })
    renderWithProviders(<BriefPanel caseId="CASE-0001" me={me()} />)
    const badge = await screen.findByTestId('brief-badge')
    expect(badge).toHaveTextContent('Template (validation fallback)')
    expect(badge).toHaveAttribute('title', 'validation failed: V5')
    expect(screen.getByText('Fallback reason: validation failed: V5')).toBeInTheDocument()
  })

  it('does not let roles that cannot generate a brief try', async () => {
    mockFetch({ 'GET /api/cases/CASE-0001/brief': { status: 204 } })
    renderWithProviders(<BriefPanel caseId="CASE-0001" me={me('GOVERNANCE')} />)
    expect(await screen.findByText(/can read briefs but not generate/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate/ })).not.toBeInTheDocument()
  })

  it('shows the server explanation when generation fails', async () => {
    mockFetch({
      'GET /api/cases/CASE-0001/brief': { status: 204 },
      'POST /api/cases/CASE-0001/brief': {
        status: 503,
        body: { code: 'BRIEF_UNAVAILABLE', detail: 'No valid brief could be built for CASE-0001.' },
      },
    })
    renderWithProviders(<BriefPanel caseId="CASE-0001" me={me()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Generate investigation brief' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No valid brief could be built')
  })

  it('flags insufficient evidence', async () => {
    const b = brief()
    b.sections.insufficientEvidence = true
    mockFetch({ 'GET /api/cases/CASE-0001/brief': b })
    renderWithProviders(<BriefPanel caseId="CASE-0001" me={me()} />)
    expect(await screen.findByRole('note')).toHaveTextContent('Insufficient evidence')
  })
})
