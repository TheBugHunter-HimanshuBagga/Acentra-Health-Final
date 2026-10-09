import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { me, mockFetch, renderWithProviders } from '@/test/utils'
import { RateAI } from './RateAI'
import { KnowledgeHealth, SentenceReview } from './ReviewViews'

const items = [{ type: 'POLICY' as const, id: 'POL-BILL-1.1', label: 'Duplicate submissions' }]

describe('Human review', () => {
  it('challenges the knowledge, lets a person disagree with a finding, and records it', async () => {
    const m = mockFetch({
      'GET /api/auth/me': me('SUPERVISOR'),
      'GET /api/review/notes?limit=20': [],
      'POST /api/knowledge/critique': { badge: 'VALIDATED', model: 'gemini-test', fallbackReason: null, findings: [{ key: 'CF-1-abc', severity: 'HIGH', area: 'Rules', issue: 'A rule has no policy backing.', suggestion: 'Link it to a policy.', refs: ['R-DOD-01'] }] },
      'POST /api/review/notes': { noteId: 'RN-1', recorded: true },
    })
    renderWithProviders(<KnowledgeHealth lint={[{ severity: 'WARN', message: 'Stale exception' }]} items={items} />)
    expect(await screen.findByText(/Stale exception/)).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /Find weaknesses/ }))
    expect(await screen.findByText('A rule has no policy backing.')).toBeInTheDocument()
    expect(screen.getByText('R-DOD-01')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /I disagree/ }))
    await userEvent.type(screen.getByLabelText('Why do you disagree with this finding?'), 'It is covered by POL-BILL')
    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(await screen.findByText(/recorded in the review log/)).toBeInTheDocument()
    const body = m.callsTo('POST', '/api/review/notes')[0].body as Record<string, string>
    expect(body).toMatchObject({ subjectType: 'CRITIQUE_FINDING', subjectId: 'CF-1-abc', verdict: 'DISAGREE', note: 'It is covered by POL-BILL' })
  })

  it('proposes a rewording and records the decision without applying anything', async () => {
    const m = mockFetch({
      'GET /api/auth/me': me('GOVERNANCE'),
      'GET /api/review/notes?limit=20': [],
      'POST /api/knowledge/finetune': { targetType: 'POLICY', targetId: 'POL-BILL-1.1', original: 'Old text.', proposed: 'Clearer text.', rationale: 'Plainer words.', badge: 'VALIDATED', model: 'gemini-test', applied: false },
      'POST /api/review/notes': { noteId: 'RN-2', recorded: true },
    })
    renderWithProviders(<KnowledgeHealth lint={[]} items={items} />)
    await userEvent.type(await screen.findByLabelText('What should change'), 'Say it in plain words')
    await userEvent.click(screen.getByRole('button', { name: /Propose wording/ }))
    expect(await screen.findByText('Clearer text.')).toBeInTheDocument()
    expect(screen.getByText('Old text.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Accept for review/ }))
    expect(await screen.findByText(/Nothing was changed/)).toBeInTheDocument()
    expect(m.callsTo('POST', '/api/review/notes')[0].body).toMatchObject({ subjectType: 'KNOWLEDGE_ITEM', subjectId: 'POLICY:POL-BILL-1.1', verdict: 'ACCEPT_PROPOSAL' })
  })

  it('lets a person disagree with one AI sentence, but not an auditor', async () => {
    const m = mockFetch({ 'GET /api/auth/me': me('INVESTIGATOR'), 'POST /api/review/notes': { noteId: 'RN-3', recorded: true } })
    const { unmount } = renderWithProviders(<SentenceReview caseId="CASE-1" subject="CASE-1:why:0" text="A sentence." />)
    await userEvent.click(await screen.findByRole('button', { name: 'Disagree with this sentence' }))
    await userEvent.type(screen.getByLabelText('Why do you disagree?'), 'The peer median is wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(await screen.findByText(/recorded for review/)).toBeInTheDocument()
    expect(m.callsTo('POST', '/api/review/notes')[0].body).toMatchObject({ subjectType: 'AI_SENTENCE', subjectId: 'CASE-1:why:0', verdict: 'DISAGREE', caseId: 'CASE-1' })
    unmount()
    mockFetch({ 'GET /api/auth/me': me('AUDITOR') })
    renderWithProviders(<SentenceReview caseId="CASE-1" subject="x" text="y" />)
    expect(screen.queryByRole('button', { name: 'Disagree with this sentence' })).toBeNull()
  })

  it('rates a whole AI output Good in one click and Bad only with a reason', async () => {
    const m = mockFetch({ 'GET /api/auth/me': me('INVESTIGATOR'), 'POST /api/review/notes': { noteId: 'RN-4', recorded: true } })
    renderWithProviders(<RateAI kind="BRIEF" subject="B-1" caseId="CASE-1" />)
    await userEvent.click(await screen.findByRole('button', { name: /Bad/ }))
    expect(screen.getByRole('button', { name: 'Record rating' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Wrong number' }))
    await userEvent.click(screen.getByRole('button', { name: 'Record rating' }))
    expect(await screen.findByTestId('rate-done')).toHaveTextContent(/Rated bad/)
    expect(m.callsTo('POST', '/api/review/notes')[0].body).toMatchObject({ subjectType: 'AI_OUTPUT', subjectId: 'BRIEF:B-1', verdict: 'BAD', note: 'Wrong number', caseId: 'CASE-1' })
  })
})
