import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { me, mockFetch, renderWithProviders } from '@/test/utils'
import { ChallengePanel, CopilotPanel } from './CopilotViews'

const answer = (over: object = {}) => ({
  question: 'Why was this flagged?', mode: 'TEMPLATE', badge: 'TEMPLATE_FALLBACK', model: null,
  validation: { passed: false, retries: 0, fallbackReason: 'model unavailable' },
  content: { source: 'DETERMINISTIC', answerable: true, sections: { answer: [{ text: '66 lines were dated after death.', citations: ['E1'] }], followUps: [] } }, ...over,
})

describe('CopilotPanel', () => {
  it('asks a suggested question and shows a cited, badged answer', async () => {
    const m = mockFetch({ 'POST /api/cases/CASE-1/copilot': answer() })
    renderWithProviders(<CopilotPanel caseId="CASE-1" me={me('INVESTIGATOR')} />)
    await userEvent.click(screen.getByRole('button', { name: 'Why was this flagged?' }))
    expect(await screen.findByText(/66 lines were dated after death/)).toBeInTheDocument()
    expect(screen.getByText('E1')).toBeInTheDocument()
    expect(screen.getByTestId('ai-badge')).toHaveTextContent('Deterministic fallback')
    expect(m.calls.find((c) => c.url.endsWith('/copilot'))?.body).toEqual({ question: 'Why was this flagged?' })
  })
  it('shows the honest not-in-the-pack answer instead of guessing', async () => {
    mockFetch({ 'POST /api/cases/CASE-1/copilot': answer({ content: { source: 'AI', answerable: false, notInPack: 'The evidence pack for this case does not contain that, so I will not guess.', sections: { answer: [] } } }) })
    renderWithProviders(<CopilotPanel caseId="CASE-1" me={me('INVESTIGATOR')} />)
    await userEvent.type(screen.getByLabelText('Ask a question'), 'weather?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(await screen.findByText(/will not guess/)).toBeInTheDocument()
  })
  it('is read-only for auditors', () => {
    mockFetch({})
    renderWithProviders(<CopilotPanel caseId="CASE-1" me={me('AUDITOR')} />)
    expect(screen.getByText(/Auditors can read explanations/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Ask a question')).toBeNull()
  })
})

describe('ChallengePanel', () => {
  it('generates the case against flagging', async () => {
    mockFetch({
      'GET /api/cases/CASE-1/challenge': { available: false },
      'POST /api/cases/CASE-1/challenge?force=false': {
        mode: 'TEMPLATE', badge: 'TEMPLATE_FALLBACK', model: null, validation: { passed: false, retries: 0, fallbackReason: null },
        content: { source: 'DETERMINISTIC', sections: { headline: [{ text: 'Arguing the other way.', citations: ['E1'] }], counterArguments: [{ text: 'A similar case was unfounded.', citations: ['CF1'] }], innocentExplanations: [], whatWouldChangeTheView: [{ text: 'Check the records.', citations: ['E1'] }] } },
      },
    })
    renderWithProviders(<ChallengePanel caseId="CASE-1" me={me('SUPERVISOR')} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Argue the other side' }))
    expect(await screen.findByText('A similar case was unfounded.')).toBeInTheDocument()
    expect(screen.getByText('Check the records.')).toBeInTheDocument()
  })
})
