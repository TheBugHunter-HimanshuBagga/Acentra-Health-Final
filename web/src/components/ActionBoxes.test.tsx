import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { caseDetail, me, mockFetch, renderWithProviders, review } from '@/test/utils'
import { ApprovalBox, ClosePanel } from './ActionBoxes'

describe('ApprovalBox (two-person rule in the UI)', () => {
  it('lets a supervisor approve someone else\'s pending action', async () => {
    const onChanged = vi.fn()
    const m = mockFetch({ 'POST /api/review-actions/RA-00001/approve': { body: { status: 'APPROVED' } } })
    renderWithProviders(<ApprovalBox reviews={[review()]} detail={caseDetail({ status: 'ACTION_PROPOSED' })}
      me={me('SUPERVISOR')} onChanged={onChanged} />)
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(m.calls[0].body).toEqual({ decision: 'APPROVE' })
    expect(onChanged).toHaveBeenCalled()
  })

  it('does not offer a supervisor their own proposal', () => {
    renderWithProviders(<ApprovalBox reviews={[review({ actor: 'supervisor', role: 'SUPERVISOR' })]}
      detail={caseDetail({ status: 'ACTION_PROPOSED' })} me={me('SUPERVISOR')} onChanged={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.getByText(/another supervisor must approve/)).toBeInTheDocument()
  })

  it('tells investigators it is waiting, with no approve button', () => {
    renderWithProviders(<ApprovalBox reviews={[review()]} detail={caseDetail({ status: 'ACTION_PROPOSED' })}
      me={me('INVESTIGATOR')} onChanged={vi.fn()} />)
    expect(screen.getByText(/Waiting for a supervisor/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('shows the server reason when approval is refused', async () => {
    mockFetch({ 'POST /api/review-actions/RA-00001/approve': { status: 403, body: { code: 'SELF_APPROVAL_FORBIDDEN',
      detail: 'The person who proposed an action cannot approve it.' } } })
    renderWithProviders(<ApprovalBox reviews={[review()]} detail={caseDetail({ status: 'ACTION_PROPOSED' })}
      me={me('SUPERVISOR')} onChanged={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot approve it')
  })

  it('offers to carry out an approved action (simulated) and nothing when there is nothing to do', async () => {
    const m = mockFetch({ 'POST /api/review-actions/RA-00001/execute': { body: { status: 'EXECUTED' } } })
    const { unmount } = renderWithProviders(<ApprovalBox reviews={[review({ status: 'APPROVED' })]}
      detail={caseDetail({ status: 'ACTION_APPROVED' })} me={me()} onChanged={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Carry out (simulated)' }))
    expect(m.calls[0].url).toBe('/api/review-actions/RA-00001/execute')
    unmount()
    const { container } = renderWithProviders(<ApprovalBox reviews={[]} detail={caseDetail()} me={me()} onChanged={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ClosePanel', () => {
  const longRationale = 'Records reviewed; the pattern is documented and consistent with care.'

  it('is hidden until the case is in a closable state and for read-only roles', () => {
    const { container, unmount } = renderWithProviders(<ClosePanel detail={caseDetail({ status: 'NEW' })} me={me()} onChanged={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    unmount()
    const r = renderWithProviders(<ClosePanel detail={caseDetail({ status: 'IN_REVIEW' })} me={me('AUDITOR')} onChanged={vi.fn()} />)
    expect(r.container).toBeEmptyDOMElement()
  })

  it('needs a reason and a useful rationale, then closes with an idempotency key', async () => {
    const onChanged = vi.fn()
    const m = mockFetch({ 'POST /api/cases/CASE-0001/close': { status: 201, body: { precedentId: 'PRC-LIVE-0001',
      exceptionEligible: false } } })
    renderWithProviders(<ClosePanel detail={caseDetail({ status: 'IN_REVIEW' })} me={me()} onChanged={onChanged} />)
    const close = screen.getByRole('button', { name: 'Close case' })
    expect(close).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Reason code'), 'CONFIRMED_PATTERN')
    await userEvent.type(screen.getByLabelText(/Rationale/), 'too short')
    expect(close).toBeDisabled()
    await userEvent.clear(screen.getByLabelText(/Rationale/))
    await userEvent.type(screen.getByLabelText(/Rationale/), longRationale)
    expect(close).toBeEnabled()
    await userEvent.click(close)
    expect(m.calls[0].body).toEqual({ outcome: 'CONFIRMED', reasonCode: 'CONFIRMED_PATTERN', rationale: longRationale })
    expect(m.calls[0].headers['Idempotency-Key']).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
  })

  it('shows the recorded outcome once closed', () => {
    renderWithProviders(<ClosePanel detail={caseDetail({ status: 'CLOSED', outcome: 'UNFOUNDED' })} me={me()} onChanged={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Closed: UNFOUNDED')
  })
})
