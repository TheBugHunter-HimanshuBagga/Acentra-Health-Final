import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { me, mockFetch, renderWithProviders } from '@/test/utils'
import { AgentPage } from './Agent'

const item = { handoffId: 'HO-0001', requestedBy: 'investigator', status: 'WAITING', reason: 'Asked for a person', caseId: 'CASE-0003', messageCount: 2, lastMessage: null }

describe('Specialist desk', () => {
  it('lists who is waiting and joins the conversation', async () => {
    const calls = mockFetch({
      'GET /api/auth/me': me('SUPERVISOR'),
      'GET /api/agent/queue': { items: [item] },
      'POST /api/agent/handoffs/HO-0001/join': { messages: [{ seq: 1, role: 'USER', sender: 'investigator', text: 'Need help with CASE-0003' }] },
    })
    renderWithProviders(<AgentPage />)
    expect(await screen.findByText('HO-0001')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Join the conversation' }))
    expect(calls.calls.some((c) => c.method === 'POST' && c.url.endsWith('/join'))).toBe(true)
  })
  it('is closed to investigators', async () => {
    mockFetch({ 'GET /api/auth/me': me('INVESTIGATOR') })
    renderWithProviders(<AgentPage />)
    expect(await screen.findByText(/for supervisors and governance/)).toBeInTheDocument()
  })
})
