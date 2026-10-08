import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { mockFetch, queueItem, renderWithProviders } from '@/test/utils'
import { QueuePage } from './Queue'

const response = (items = [queueItem(), queueItem({ caseId: 'CASE-0008', rank: 2, tier: 'MEDIUM', hypotheses: ['DME'],
  inCapacity: false, deferReason: 'exceeds remaining capacity', status: 'IN_REVIEW',
  dollars: { exact: 29800, estimated: 0, basis: 'EXACT' } })]) => ({
  runId: 'RUN-001', horizon: 90, capacityHours: 240, usedHours: 11, items,
})

describe('QueuePage', () => {
  it('lists cases with tier as a word, exact dollars, status and capacity decision', async () => {
    mockFetch({ 'GET /api/queue': response() })
    renderWithProviders(<QueuePage />)
    expect(await screen.findByRole('link', { name: 'CASE-0003' })).toHaveAttribute('href', '/cases/CASE-0003')
    expect(screen.getByLabelText('HIGH confidence')).toHaveTextContent('HIGH')
    expect(screen.getByLabelText('MEDIUM confidence')).toHaveTextContent('MEDIUM')
    expect(screen.getByText('$37,591.20')).toBeInTheDocument()
    expect(screen.getByText('$29,800.00')).toBeInTheDocument()
    expect(screen.getByText('Deferred: exceeds remaining capacity')).toBeInTheDocument()
    expect(screen.getByText('In capacity')).toBeInTheDocument()
    expect(screen.getByText('IN_REVIEW')).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 cases fit/)).toBeInTheDocument()
  })

  it('asks the server again when the horizon or the capacity changes', async () => {
    const m = mockFetch({ 'GET /api/queue': response() })
    renderWithProviders(<QueuePage />)
    await screen.findByText('CASE-0003')
    expect(m.calls[0].url).toBe('/api/queue?horizon=90&capacityHours=240')

    await userEvent.selectOptions(screen.getByLabelText('Risk horizon'), '30')
    await waitFor(() => expect(m.calls.some((c) => c.url.includes('horizon=30'))).toBe(true))

    const cap = screen.getByLabelText('Investigator hours')
    await userEvent.clear(cap)
    await userEvent.type(cap, '40')
    await waitFor(() => expect(m.calls.some((c) => c.url.includes('capacityHours=40'))).toBe(true))
  })

  it('shows empty and error states', async () => {
    mockFetch({ 'GET /api/queue': response([]) })
    const { unmount } = renderWithProviders(<QueuePage />)
    expect(await screen.findByText('No cases in this run.')).toBeInTheDocument()
    unmount()
    mockFetch({ 'GET /api/queue': { status: 500, body: { code: 'INTERNAL_ERROR', detail: 'x' } } })
    renderWithProviders(<QueuePage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded')
  })
})
