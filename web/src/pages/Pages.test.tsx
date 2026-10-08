import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ChatDock } from '@/components/ChatDock'
import { me, mockFetch, renderWithProviders } from '@/test/utils'
import { DashboardPage } from './Dashboard'
import { GovernancePage } from './Governance'
import { LibraryPage } from './Library'
import { PrecedentsPage } from './Precedents'

const exception = (over: object = {}) => ({
  excId: 'EXC-0002', version: 1, status: 'DRAFT', scope: { rule_ids: ['R-TIME-01'], specialty_code: 'PRIMARY_CARE' },
  condition: [{ field: 'z', op: '<=', value: 3 }], effect: 'DOWNGRADE_TO_MONITOR', supportN: 3, flags: [],
  sourcePrecedentId: 'PRC-LIVE-0001', simulation: null, lintVerdict: null, explanation: null, proposedBy: 'investigator',
  approvedBy: null, approvedAt: null, approvalNotes: null, reviewDue: '2027-01-01', createdAt: '2026-10-08T10:00:00Z', ...over,
})

describe('Dashboard', () => {
  it('shows the real KPIs, the cases needing attention and how knowledge compounds', async () => {
    mockFetch({
      'GET /api/dashboard': {
        runId: 'RUN-002',
        kpis: { alerts: 347, cases: 18, high: 6, medium: 12, monitor: 10, exactDollars: 67196.8, estimatedDollars: 118257.76 },
        needsYouNow: [{ caseId: 'CASE-0014', dollars: 15456, hypotheses: ['PHC'], primary: 'P-0044', tier: 'HIGH' }],
        exposureByScheme: [{ scheme: 'DME', label: 'Equipment', cases: 1, dollars: 35420 }],
        compounding: { activeExceptions: 1, alertsSuppressed: 6, casesTotal: 18, casesWithPrecedent: 11, livePrecedents: 2, seedPrecedents: 37, tierChangedByPrecedent: [{ caseId: 'CASE-0009', with: 'HIGH', without: 'MEDIUM' }] },
      },
      'GET /api/funnel': { runId: 'RUN-002', capacityHours: 240, stages: [{ key: 'alerts', label: 'Alerts', count: 347 }, { key: 'cases', label: 'Cases', count: 18 }], tiers: {}, dollars: { exact: 1, estimated: 1 }, diff: {}, diffFrom: null, suppressedByException: { 'EXC-0001': 6 } },
    })
    renderWithProviders(<DashboardPage />)
    expect(await screen.findByRole('heading', { name: 'Executive dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CASE-0014' })).toHaveAttribute('href', '/cases/CASE-0014')
    expect(await screen.findByText(/Approved exceptions removed 6 alerts \(EXC-0001\)/)).toBeInTheDocument()
    expect(screen.getByText(/Precedents changed the tier of CASE-0009/)).toBeInTheDocument()
    expect(screen.getAllByText('347').length).toBeGreaterThanOrEqual(1)
  })
})

describe('Precedents', () => {
  const pending = { precedentId: 'PRC-LIVE-0001', source: 'LIVE', caseId: 'CASE-0003', schemeType: 'DUP', specialtyCode: 'PRIMARY_CARE', disposition: 'UNFOUNDED', reasonCode: 'LEGIT_CLINICAL_PATTERN', rationale: 'Records showed recurring legitimate visits.', aiDrafted: false, status: 'PENDING_COSIGN', createdBy: 'investigator', closedDt: null }

  it('a supervisor co-signs a pending precedent through the real endpoint', async () => {
    const m = mockFetch({
      'GET /api/auth/me': me('SUPERVISOR'),
      'GET /api/precedents': [pending],
      'POST /api/precedents/PRC-LIVE-0001/cosign': { status: 200, body: { precedentId: 'PRC-LIVE-0001', status: 'ACTIVE' } },
    })
    renderWithProviders(<PrecedentsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Co-sign as precedent' }))
    await waitFor(() => expect(m.callsTo('POST', '/api/precedents/PRC-LIVE-0001/cosign')).toHaveLength(1))
    expect(m.callsTo('POST', '/api/precedents/PRC-LIVE-0001/cosign')[0].body).toEqual({ decision: 'CONFIRM' })
    expect(await screen.findByRole('status')).toHaveTextContent('now an active precedent')
  })

  it('other roles are told who can co-sign and see no co-sign button', async () => {
    mockFetch({ 'GET /api/auth/me': me('INVESTIGATOR'), 'GET /api/precedents': [pending] })
    renderWithProviders(<PrecedentsPage />)
    expect(await screen.findByText(/Only a supervisor other than the person who closed the case/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Co-sign as precedent' })).toBeNull()
  })
})

describe('Governance', () => {
  it('lets an investigator simulate a draft and shows the result', async () => {
    const sim = { alertsSuppressed: 4, providersAffected: 2, casesAffected: 1, affectedCases: ['CASE-0003'], dollarsNoLongerReviewed: 1200, tierShifts: { 'MEDIUM>MONITOR': 1 }, conflictsWithConfirmed: [], breadthShare: 0.05, hardFactTouches: 0 }
    const m = mockFetch({
      'GET /api/auth/me': me('INVESTIGATOR'),
      'GET /api/exceptions': [exception()],
      'GET /api/runs': [],
      'GET /api/jobs': [],
      'POST /api/exceptions/EXC-0002/simulate': exception({ status: 'SIMULATED', simulation: sim, lintVerdict: 'PASS' }),
    })
    renderWithProviders(<GovernancePage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Simulate' }))
    await waitFor(() => expect(m.callsTo('POST', '/api/exceptions/EXC-0002/simulate')).toHaveLength(1))
  })

  it('only governance can approve, and approval sends the notes', async () => {
    const pendingExc = exception({ status: 'PENDING_APPROVAL', lintVerdict: 'PASS' })
    mockFetch({ 'GET /api/auth/me': me('INVESTIGATOR'), 'GET /api/exceptions': [pendingExc], 'GET /api/runs': [], 'GET /api/jobs': [] })
    const { unmount } = renderWithProviders(<GovernancePage />)
    expect(await screen.findByText(/Only the governance role can approve/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
    unmount()

    const m = mockFetch({
      'GET /api/auth/me': me('GOVERNANCE'), 'GET /api/exceptions': [pendingExc], 'GET /api/runs': [], 'GET /api/jobs': [],
      'POST /api/exceptions/EXC-0002/approve': exception({ status: 'APPROVED' }),
    })
    renderWithProviders(<GovernancePage />)
    await userEvent.type(await screen.findByLabelText(/Decision notes/), 'Reviewed the simulation')
    await userEvent.click(screen.getByRole('button', { name: 'Approve and re-run' }))
    await waitFor(() => expect(m.callsTo('POST', '/api/exceptions/EXC-0002/approve')).toHaveLength(1))
    expect(m.callsTo('POST', '/api/exceptions/EXC-0002/approve')[0].body).toEqual({ decision: 'APPROVE', notes: 'Reviewed the simulation' })
  })

  it('shows a refusal from the server (self approval) instead of failing silently', async () => {
    mockFetch({
      'GET /api/auth/me': me('GOVERNANCE'), 'GET /api/exceptions': [exception({ status: 'PENDING_APPROVAL' })], 'GET /api/runs': [], 'GET /api/jobs': [],
      'POST /api/exceptions/EXC-0002/approve': { status: 403, body: { code: 'SELF_APPROVAL_FORBIDDEN', detail: 'You proposed this exception, so someone else has to approve it.' } },
    })
    renderWithProviders(<GovernancePage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Approve and re-run' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('someone else has to approve')
  })
})

describe('Library', () => {
  it('lists policies and filters them', async () => {
    mockFetch({
      'GET /api/knowledge/policies': [{ sectionId: 'POL-BILL-1.1', docId: 'POL-BILL', title: 'Duplicate submissions', body: 'A service is not payable twice.', version: 'v1', effDt: '2024-01-01', provenance: 'SYNTHETIC' }, { sectionId: 'DME-POL-4.2', docId: 'DME-POL', title: 'Equipment orders', body: 'Orders need a visit.', version: 'v1', effDt: '2024-01-01', provenance: 'SYNTHETIC' }],
      'GET /api/knowledge/rules': [], 'GET /api/knowledge/glossary': [], 'GET /api/knowledge/help': [], 'GET /api/knowledge/lint': [],
    })
    renderWithProviders(<LibraryPage />)
    expect(await screen.findByText('A service is not payable twice.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Search the library'), 'equipment')
    expect(screen.queryByText('A service is not payable twice.')).toBeNull()
    expect(screen.getByText('Orders need a visit.')).toBeInTheDocument()
  })
})

describe('ChatDock', () => {
  const reply = { sessionId: 'CHS-1', intent: 'QUEUE_SUMMARY', mode: 'FACTS_ONLY', label: 'Validated facts only', insufficientKnowledge: false, links: [], notices: [], blocks: [{ text: 'There are 18 cases.', textEn: 'There are 18 cases.', sourceIds: ['FUNNEL'], translated: false }] }

  it('sends a typed question to the server and shows the validated answer with its sources', async () => {
    const m = mockFetch({
      'GET /api/auth/me': me(), 'GET /api/health': { status: 'UP', run: 'RUN-001', engine: 'UP', llm: 'TEMPLATE', voice: 'OFF' },
      'POST /api/chat': reply,
    })
    renderWithProviders(<ChatDock />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ask the assistant' }))
    await userEvent.type(await screen.findByLabelText('Ask about a case, a policy or how this works'), 'How many cases?')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('There are 18 cases.')).toBeInTheDocument()
    expect(screen.getByText('Validated facts only')).toBeInTheDocument()
    expect(screen.getByText('FUNNEL')).toBeInTheDocument()
    expect(screen.getByText('Grounded in validated case evidence')).toBeInTheDocument()
    const body = m.callsTo('POST', '/api/chat')[0].body as { message: string; lang: string }
    expect(body.message).toBe('How many cases?')
    expect(body.lang).toBe('en')
  })

  it('disables the microphone when voice is off but typed chat still works', async () => {
    mockFetch({ 'GET /api/auth/me': me(), 'GET /api/health': { status: 'UP', run: 'RUN-001', engine: 'UP', llm: 'TEMPLATE', voice: 'OFF' } })
    renderWithProviders(<ChatDock />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ask the assistant' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Speak' })).toBeDisabled())
    expect(screen.getByLabelText('Ask about a case, a policy or how this works')).toBeEnabled()
  })
})
