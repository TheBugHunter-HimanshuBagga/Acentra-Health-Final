import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import type { CaseDetail, Me, QueueItem, ReviewRecord, Role } from '@/lib/types'

export interface Call {
  url: string
  method: string
  body: unknown
  headers: Record<string, string>
}
export type Reply = { status?: number; body?: unknown }
export type Handler = Reply | ((call: Call) => Reply) | object | unknown[]

/** A handler object is a *reply* ({status, body}) only if it has exactly those keys; anything else is a raw 200 body. */
function isReply(h: unknown): h is Reply {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return false
  const keys = Object.keys(h)
  const only = keys.every((k) => k === 'status' || k === 'body')
  const status = (h as Reply).status
  return only && (keys.includes('body') || typeof status === 'number') && (status === undefined || typeof status === 'number')
}

/** Stubs global fetch. Routes are keyed "METHOD /path" (query string ignored unless the key includes it). */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const call: Call = {
      url,
      method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    }
    calls.push(call)
    const handler = routes[`${method} ${url}`] ?? routes[`${method} ${url.split('?')[0]}`]
    if (handler === undefined) {
      return new Response(JSON.stringify({ code: 'NOT_FOUND', detail: `no mock for ${method} ${url}` }), { status: 404 })
    }
    const reply: Reply =
      typeof handler === 'function' ? handler(call) : isReply(handler) ? handler : { body: handler }
    const status = reply.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(reply.body), { status })
  })
  vi.stubGlobal('fetch', fn)
  return { calls, fn, callsTo: (method: string, prefix: string) => calls.filter((c) => c.method === method && c.url.startsWith(prefix)) }
}

export function renderWithProviders(ui: ReactElement, route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

export const me = (role: Role = 'INVESTIGATOR', username = role.toLowerCase()): Me => ({
  id: `U-${username}`,
  username,
  displayName: `${username} user`,
  role,
  language: 'en',
  onboarded: true,
  onboardingSkipped: false,
})

export const caseDetail = (over: Partial<CaseDetail> = {}): CaseDetail => ({
  caseId: 'CASE-0001',
  tier: 'HIGH',
  tierReasons: [{ id: 'TR1', text: 'Direct recorded fact on exact dollars (1,766.40)' }],
  subjects: [{ id: 'P-0005', role: 'PRIMARY', label: 'Synthetic Primary_Care 05', specialty: 'PRIMARY_CARE' }],
  hypotheses: [
    { code: 'PHA', text: 'Services dated after a recorded death', dollars: 1766.4 },
    { code: 'DUP', text: 'Billing pattern consistent with duplicate submission', dollars: 10 },
  ],
  factors: { risk: 0.85, dollarScore: 0.4, memberImpact: 0.3, severity: 0.95, evidenceStrength: 0.61 },
  dollars: { exact: 1766.4, estimated: 0, basis: 'EXACT' },
  trend: 'STABLE',
  estHours: 6,
  memberCount: 8,
  ruleIds: ['R-DOD-01'],
  hardFactAlerts: true,
  defaultAction: 'REQUEST_RECORDS',
  permittedActions: [
    { action: 'REQUEST_RECORDS', needs: 'NONE' },
    { action: 'PROVIDER_EDUCATION', needs: 'NONE' },
    { action: 'MONITOR', needs: 'NONE' },
    { action: 'PREPAY_REVIEW_FLAG', needs: 'SUPERVISOR' },
    { action: 'REFER_EXTERNAL', needs: 'SUPERVISOR' },
  ],
  packSha256: 'a'.repeat(64),
  status: 'NEW',
  assignedTo: null,
  outcome: null,
  outlook: { available: false },
  briefAvailable: false,
  ...over,
})

export const queueItem = (over: Partial<QueueItem> = {}): QueueItem => ({
  caseId: 'CASE-0003',
  rank: 1,
  tier: 'HIGH',
  status: 'NEW',
  subjects: [{ id: 'P-0007', role: 'PRIMARY', label: 'x', specialty: 'PRIMARY_CARE' }],
  hypotheses: ['EXC'],
  factors: { risk: 0.85, dollarScore: 1, memberImpact: 0.3, severity: 1, evidenceStrength: 0.61 },
  utility: 0.81,
  dollars: { exact: 37591.2, estimated: 0, basis: 'EXACT' },
  trend: 'ESCALATING',
  estHours: 11,
  inCapacity: true,
  deferReason: null,
  assignedTo: null,
  ...over,
})

export const review = (over: Partial<ReviewRecord> = {}): ReviewRecord => ({
  actionId: 'RA-00001',
  actor: 'investigator',
  role: 'INVESTIGATOR',
  action: 'MODIFY',
  status: 'PENDING_APPROVAL',
  reasonCode: 'NEEDS_RECORDS',
  notes: null,
  requiresApproval: true,
  humanDecision: { action: 'PREPAY_REVIEW_FLAG', hypothesis: 'PHA' },
  approver: null,
  createdAt: '2026-10-08T10:00:00Z',
  ...over,
})
