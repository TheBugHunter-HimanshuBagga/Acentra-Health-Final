import { screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { caseDetail, me, mockFetch, renderWithProviders } from '@/test/utils'
import { DecisionPanel } from './DecisionPanel'

const ok = { caseId: 'CASE-0001', caseStatus: 'ACTION_APPROVED', effectiveAction: 'REQUEST_RECORDS', status: 'APPROVED',
  requiresApproval: false, approvalNeeded: null, actionId: 'RA-00001' }
const submitBtn = () => screen.getByRole('button', { name: 'Record decision' })

describe('DecisionPanel', () => {
  it('is read-only for roles that cannot decide, and for cases that are no longer reviewable', () => {
    renderWithProviders(<DecisionPanel detail={caseDetail()} me={me('AUDITOR')} onChanged={vi.fn()} />)
    expect(screen.getByText(/read-only for case decisions/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record decision' })).not.toBeInTheDocument()
  })

  it('refuses to review a case that is already actioned', () => {
    renderWithProviders(<DecisionPanel detail={caseDetail({ status: 'ACTION_APPROVED' })} me={me()} onChanged={vi.fn()} />)
    expect(screen.getByText(/cannot be reviewed again/)).toBeInTheDocument()
  })

  it('Accept sends just the action, with an idempotency key, and reports the new status', async () => {
    const onChanged = vi.fn()
    const m = mockFetch({ 'POST /api/cases/CASE-0001/review': { status: 201, body: ok } })
    renderWithProviders(<DecisionPanel detail={caseDetail()} me={me()} onChanged={onChanged} />)
    await userEvent.click(submitBtn())
    expect(await screen.findByRole('status')).toHaveTextContent('ACTION_APPROVED')
    expect(m.calls[0].body).toEqual({ action: 'ACCEPT' })
    expect(m.calls[0].headers['Idempotency-Key']).toMatch(/[0-9a-f-]{36}/)
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('Modify offers only permitted actions, marks the ones needing a supervisor, and needs a reason and a change', async () => {
    mockFetch({})
    renderWithProviders(<DecisionPanel detail={caseDetail({ permittedActions: [
      { action: 'REQUEST_RECORDS', needs: 'NONE' }, { action: 'PREPAY_REVIEW_FLAG', needs: 'SUPERVISOR' }] })}
      me={me()} onChanged={vi.fn()} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Modify' }))
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('PREPAY_REVIEW_FLAG (needs supervisor approval)')
    expect(options).not.toContain('REFER_EXTERNAL')
    expect(submitBtn()).toBeDisabled()
    expect(screen.getByText('Choose a reason code.')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Reason code'), 'NEEDS_RECORDS')
    expect(screen.getByText('Change the action or the pattern first.')).toBeInTheDocument()
    expect(submitBtn()).toBeDisabled()

    await userEvent.selectOptions(screen.getByLabelText('Action'), 'PREPAY_REVIEW_FLAG')
    expect(submitBtn()).toBeEnabled()
  })

  it('Modify posts the chosen action, pattern, reason and notes', async () => {
    const m = mockFetch({ 'POST /api/cases/CASE-0001/review': { status: 201, body: { ...ok, caseStatus: 'ACTION_PROPOSED',
      requiresApproval: true } } })
    renderWithProviders(<DecisionPanel detail={caseDetail()} me={me()} onChanged={vi.fn()} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Modify' }))
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'PREPAY_REVIEW_FLAG')
    await userEvent.selectOptions(screen.getByLabelText('Pattern'), 'DUP')
    await userEvent.selectOptions(screen.getByLabelText('Reason code'), 'NEEDS_RECORDS')
    await userEvent.type(screen.getByLabelText(/Notes/), '  hold payment  ')
    await userEvent.click(submitBtn())
    expect(await screen.findByRole('status')).toHaveTextContent('waits for a supervisor');
    expect(m.calls[0].body).toEqual({ action: 'MODIFY', newAction: 'PREPAY_REVIEW_FLAG', hypothesis: 'DUP',
      reasonCode: 'NEEDS_RECORDS', notes: 'hold payment' })
  })

  it('Reject requires a reason code; Request info requires notes', async () => {
    mockFetch({})
    renderWithProviders(<DecisionPanel detail={caseDetail()} me={me()} onChanged={vi.fn()} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Reject' }))
    expect(submitBtn()).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Reason code'), 'LEGIT_CLINICAL_PATTERN')
    expect(submitBtn()).toBeEnabled()

    await userEvent.click(screen.getByRole('radio', { name: 'Request info' }))
    expect(submitBtn()).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/Notes/), 'need records')
    expect(submitBtn()).toBeEnabled()
  })

  it('shows the server explanation on failure and retries with the SAME idempotency key', async () => {
    let attempt = 0
    const m = mockFetch({ 'POST /api/cases/CASE-0001/review': () => (++attempt === 1
      ? { status: 409, body: { code: 'STATE_CONFLICT', detail: 'Case CASE-0001 is IN_REVIEW and cannot be reviewed now.' } }
      : { status: 201, body: ok }) })
    renderWithProviders(<DecisionPanel detail={caseDetail()} me={me()} onChanged={vi.fn()} />)
    await userEvent.click(submitBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be reviewed now')
    await userEvent.click(submitBtn())
    await screen.findByRole('status')
    expect(m.calls[1].headers['Idempotency-Key']).toBe(m.calls[0].headers['Idempotency-Key'])
  })

  it('uses a NEW idempotency key after a success', async () => {
    const m = mockFetch({ 'POST /api/cases/CASE-0001/review': { status: 201, body: ok } })
    renderWithProviders(<DecisionPanel detail={caseDetail()} me={me()} onChanged={vi.fn()} />)
    await userEvent.click(submitBtn())
    await screen.findByRole('status')
    await userEvent.click(submitBtn())
    await waitFor(() => expect(m.calls).toHaveLength(2))
    expect(m.calls[1].headers['Idempotency-Key']).not.toBe(m.calls[0].headers['Idempotency-Key'])
  })

  it('keeps the confirmation visible when the case refreshes into a non-reviewable status (real page behaviour)', async () => {
    mockFetch({ 'POST /api/cases/CASE-0001/review': { status: 201, body: { ...ok, caseStatus: 'ACTION_PROPOSED',
      requiresApproval: true } } })
    // behaves like the real page: onChanged refetches the case, whose status is then ACTION_PROPOSED
    function Page() {
      const [detail, setDetail] = useState(caseDetail())
      return <DecisionPanel detail={detail} me={me()} onChanged={() => setDetail(caseDetail({ status: 'ACTION_PROPOSED' }))} />
    }
    renderWithProviders(<Page />)
    await userEvent.click(submitBtn())
    expect(await screen.findByRole('status')).toHaveTextContent('Case is now ACTION_PROPOSED and waits for a supervisor')
    expect(screen.queryByText(/cannot be reviewed again/)).not.toBeInTheDocument()
  })

  it('does not show a stale confirmation once the case status has moved on', async () => {
    mockFetch({ 'POST /api/cases/CASE-0001/review': { status: 201, body: { ...ok, caseStatus: 'ACTION_PROPOSED' } } })
    function Page() {
      const [detail, setDetail] = useState(caseDetail())
      return (
        <>
          <DecisionPanel detail={detail} me={me()} onChanged={() => setDetail(caseDetail({ status: 'IN_REVIEW' }))} />
        </>
      )
    }
    renderWithProviders(<Page />)
    await userEvent.click(submitBtn())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record decision' })).toBeInTheDocument())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()   // status IN_REVIEW != recorded ACTION_PROPOSED
  })
})
