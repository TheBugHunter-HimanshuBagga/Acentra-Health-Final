import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockFetch } from '@/test/utils'
import { api, ApiError } from './api'

describe('api()', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=tok%2B123; path=/'
  })
  afterEach(() => {
    document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  })

  it('sends no CSRF header on GET but sends the cookie token on writes', async () => {
    const m = mockFetch({ 'GET /api/x': { ok: 1 }, 'POST /api/y': { ok: 2 } })
    await api('/api/x')
    await api('/api/y', { method: 'POST', body: { a: 1 } })
    expect(m.calls[0].headers['X-XSRF-TOKEN']).toBeUndefined()
    expect(m.calls[1].headers['X-XSRF-TOKEN']).toBe('tok+123')
    expect(m.calls[1].headers['Content-Type']).toBe('application/json')
    expect(m.calls[1].body).toEqual({ a: 1 })
  })

  it('forwards the idempotency key', async () => {
    const m = mockFetch({ 'POST /api/y': {} })
    await api('/api/y', { method: 'POST', body: {}, idempotencyKey: 'k-1' })
    expect(m.calls[0].headers['Idempotency-Key']).toBe('k-1')
  })

  it('turns a problem+json response into an ApiError with code, detail and field errors', async () => {
    mockFetch({
      'POST /api/z': {
        status: 422,
        body: { code: 'ACTION_NOT_PERMITTED', detail: 'Nope.', errors: [{ field: 'newAction', message: 'bad' }] },
      },
    })
    const err = (await api('/api/z', { method: 'POST', body: {} }).catch((e) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 422, code: 'ACTION_NOT_PERMITTED', detail: 'Nope.' })
    expect(err.errors).toEqual([{ field: 'newAction', message: 'bad' }])
  })

  it('returns undefined for 204 and always uses same-origin credentials', async () => {
    const m = mockFetch({ 'POST /api/out': { status: 204 } })
    expect(await api('/api/out', { method: 'POST' })).toBeUndefined()
    expect(m.fn.mock.calls[0][1]?.credentials).toBe('same-origin')
  })
})
