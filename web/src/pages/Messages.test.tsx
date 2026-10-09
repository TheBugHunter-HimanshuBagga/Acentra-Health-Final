import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { me, mockFetch, renderWithProviders } from '@/test/utils'
import { AgentPage } from './Messages'

const base = {
  'GET /api/people': [{ username: 'supervisor', displayName: 'Sam Supervisor', role: 'SUPERVISOR' }],
  'GET /api/queue?horizon=90&capacityHours=1000': { items: [{ caseId: 'CASE-0014', tier: 'HIGH' }] },
}

describe('Messages', () => {
  it('starts a conversation with a person and attaches a case', async () => {
    let created = false
    const m = mockFetch({
      ...base,
      'GET /api/auth/me': me('INVESTIGATOR'),
      'GET /api/dm/threads': () => ({ body: created ? [{ threadId: 'DM-1', with: { username: 'supervisor', displayName: 'Sam Supervisor', role: 'SUPERVISOR' }, unread: 0, updatedAt: '2026-10-09T10:00:00Z', last: { sender: 'investigator', text: 'Please look', caseId: 'CASE-0014', at: '2026-10-09T10:00:00Z' } }] : [] }),
      'POST /api/dm/threads': () => { created = true; return { body: { threadId: 'DM-1' } } },
      'GET /api/dm/threads/DM-1': { threadId: 'DM-1', with: { username: 'supervisor', displayName: 'Sam Supervisor', role: 'SUPERVISOR' }, messages: [{ seq: 1, sender: 'investigator', text: 'Please look', caseId: 'CASE-0014', at: '2026-10-09T10:00:00Z', mine: true }] },
      'POST /api/dm/threads/DM-1/read': { read: true },
    })
    renderWithProviders(<AgentPage />, '/agent')
    expect(await screen.findByText(/No conversations yet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /New conversation/ }))
    await userEvent.selectOptions(await screen.findByLabelText('Who'), 'supervisor')
    await userEvent.selectOptions(screen.getByLabelText('About a case (optional)'), 'CASE-0014')
    await userEvent.type(screen.getByLabelText('Your message'), 'Please look')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(m.callsTo('POST', '/api/dm/threads')[0].body).toEqual({ to: 'supervisor', caseId: 'CASE-0014', text: 'Please look' })
    expect(await screen.findByText('Attached case')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Canvas' })).toHaveAttribute('href', '/investigate/CASE-0014')
  })

  it('keeps assistant requests on their own tab for specialists, and hides Messages from auditors', async () => {
    mockFetch({ ...base, 'GET /api/auth/me': me('SUPERVISOR'), 'GET /api/dm/threads': [], 'GET /api/agent/queue': { items: [] } })
    const { unmount } = renderWithProviders(<AgentPage />, '/agent')
    expect(await screen.findByRole('tab', { name: 'Assistant requests' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Assistant requests' }))
    expect(await screen.findByText(/This is separate from your direct messages/)).toBeInTheDocument()
    unmount()
    mockFetch({ 'GET /api/auth/me': me('AUDITOR') })
    renderWithProviders(<AgentPage />, '/agent')
    expect(await screen.findByText(/Auditors read the audit trail/)).toBeInTheDocument()
  })
})
