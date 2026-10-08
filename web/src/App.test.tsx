import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { caseDetail, me, mockFetch, queueItem, renderWithProviders, review } from '@/test/utils'

const emptyQueue = { runId: 'RUN-001', horizon: 90, capacityHours: 240, usedHours: 0, items: [] }
const unauth = { status: 401, body: { code: 'AUTH_REQUIRED', detail: 'Please sign in to continue.' } }

describe('App', () => {
  it('sends anonymous visitors to the sign-in page', async () => {
    mockFetch({ 'GET /api/auth/me': unauth })
    renderWithProviders(<App />, '/')
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('signs in, shows the queue, and surfaces a failed sign-in', async () => {
    let signedIn = false
    const m = mockFetch({
      'GET /api/auth/me': () => (signedIn ? { body: me() } : unauth),
      'POST /api/auth/login': (c) => {
        if ((c.body as { password: string }).password !== 'right') {
          return { status: 401, body: { code: 'INVALID_CREDENTIALS', detail: 'The username or password is incorrect.' } }
        }
        signedIn = true
        return { body: me() }
      },
      'GET /api/queue': emptyQueue,
    })
    renderWithProviders(<App />, '/login')
    await userEvent.type(screen.getByLabelText('Username'), 'investigator')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('incorrect')

    await userEvent.clear(screen.getByLabelText('Password'))
    await userEvent.type(screen.getByLabelText('Password'), 'right')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'SIU queue' })).toBeInTheDocument()
    expect(m.callsTo('POST', '/api/auth/login')).toHaveLength(2)
  })

  it('lets the demo switch role, and shows who is acting', async () => {
    let role: 'INVESTIGATOR' | 'SUPERVISOR' = 'INVESTIGATOR'
    mockFetch({
      'GET /api/auth/me': () => ({ body: me(role) }),
      'POST /api/auth/switch-role': (c) => { role = (c.body as { role: 'SUPERVISOR' }).role; return { body: me(role) } },
      'GET /api/queue': emptyQueue,
    })
    renderWithProviders(<App />, '/')
    expect(await screen.findByText(/investigator user \(INVESTIGATOR\)/)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Demo: act as role'), 'SUPERVISOR')
    expect(await screen.findByText(/supervisor user \(SUPERVISOR\)/)).toBeInTheDocument()
  })

  it('case page: evidence, claim lines, decision panel and history come together', async () => {
    const pack = { caseId: 'CASE-0001', hypotheses: ['PHA'], defaultAction: 'REQUEST_RECORDS', permittedActions: [], policies: [],
      limitations: [{ id: 'L1', mandatory: true, text: 'All data in this system is synthetic.' }],
      evidence: [{ id: 'E1', detector: 'R-DOD-01@v1', channel: 'LINE', name: 'x', hardFact: true, dollars: 1766.4, lineCount: 24,
        statement: '24 lines have service dates after the member\'s recorded date of death', policyRefs: ['POL-ELIG-3.1'] }] }
    const claims = { total: 24, page: 0, size: 10, items: [{ evidenceId: 'E1', claimId: 'C-0000000001', lineNo: 1, memberId: 'M-1',
      providerId: 'P-0005', serviceDt: '2025-03-01', hcpcs: '99213', label: 'Office visit, established patient, level 3', units: 1,
      paid: 73.6, flagRole: 'POST_DEATH' }] }
    mockFetch({
      'GET /api/auth/me': me(),
      'GET /api/cases/CASE-0001': caseDetail(),
      'GET /api/cases/CASE-0001/evidence': pack,
      'GET /api/cases/CASE-0001/claims': claims,
      'GET /api/cases/CASE-0001/reviews': [review({ status: 'APPROVED', approver: 'supervisor' })],
    })
    renderWithProviders(<App />, '/cases/CASE-0001')
    expect(await screen.findByRole('heading', { name: 'CASE-0001' })).toBeInTheDocument()
    expect(screen.getByText(/24 lines have service dates after/)).toBeInTheDocument()
    expect(screen.getByText('POST_DEATH')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 3 (24 lines)')).toBeInTheDocument()
    expect(screen.getByText('All data in this system is synthetic.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record decision' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/approved by supervisor/)).toBeInTheDocument())
    expect(screen.getAllByText(/not findings/).length).toBeGreaterThanOrEqual(1)   // shell banner and case header
  })

  it('audit page: investigators are told it is not for them; supervisors can verify the chain', async () => {
    mockFetch({ 'GET /api/auth/me': me('INVESTIGATOR') })
    const { unmount } = renderWithProviders(<App />, '/audit')
    expect(await screen.findByText(/available to supervisors, governance and auditors/)).toBeInTheDocument()
    unmount()

    mockFetch({
      'GET /api/auth/me': me('SUPERVISOR'),
      'GET /api/audit': { items: [{ seq: 2, ts: '2026-10-08T10:00:00Z', actor: 'investigator', role: 'INVESTIGATOR',
        eventType: 'REVIEW_ACTION', entityType: 'case', entityId: 'CASE-0001', hash: 'abcdef0123456789' }], nextCursor: null },
      'GET /api/audit/verify': { ok: true, checked: 2, firstBadSeq: null },
    })
    renderWithProviders(<App />, '/audit')
    expect(await screen.findByText('REVIEW_ACTION')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Verify chain' }))
    expect(await screen.findByText('Chain verified: 2 events intact.')).toBeInTheDocument()
  })

  it('queue rows come through the app shell', async () => {
    mockFetch({
      'GET /api/auth/me': me(),
      'GET /api/queue': { ...emptyQueue, items: [queueItem()] },
    })
    renderWithProviders(<App />, '/')
    expect(await screen.findByRole('link', { name: 'CASE-0003' })).toBeInTheDocument()
  })
})
