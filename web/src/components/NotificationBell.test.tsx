import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { mockFetch, renderWithProviders } from '@/test/utils'
import { NotificationBell } from './NotificationBell'

const item = (over: object = {}) => ({ id: 'NT-1', kind: 'HANDOFF_REQUESTED', title: 'Ivy Investigator needs a specialist', body: 'Need a policy answer', link: '/agent?open=HO-1', count: 1, createdAt: new Date().toISOString(), read: false, ...over })

describe('NotificationBell', () => {
  it('tells someone who signs in later what is waiting, and clears it when they read it', async () => {
    let feed = { unread: 1, items: [item()] }
    const m = mockFetch({
      'GET /api/notifications': () => ({ body: feed }),
      'POST /api/notifications/read': () => { feed = { unread: 0, items: [item({ read: true })] }; return { body: feed } },
    })
    renderWithProviders(<NotificationBell />)
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' })
    expect(await screen.findByText(/You have 1 unread notification/)).toBeInTheDocument()     // the sign-in summary toast
    await userEvent.click(bell)
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Mark all read/ }))
    expect(m.callsTo('POST', '/api/notifications/read')[0].body).toEqual({ all: true })
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('shows an honest empty state', async () => {
    mockFetch({ 'GET /api/notifications': { unread: 0, items: [] } })
    renderWithProviders(<NotificationBell />)
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }))
    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument()
  })
})
