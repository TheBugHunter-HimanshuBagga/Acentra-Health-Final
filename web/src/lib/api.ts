/** Thin fetch wrapper: same-origin cookies, CSRF header from the XSRF-TOKEN cookie, problem+json errors. */

export interface FieldError {
  field: string
  message: string
}

export class ApiError extends Error {
  status: number
  code: string
  detail: string
  errors: FieldError[]

  constructor(status: number, code: string, detail: string, errors: FieldError[] = []) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
    this.errors = errors
  }
}

function csrfToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT'
  body?: unknown
  idempotencyKey?: string
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET') {
    const token = csrfToken()
    if (token) headers['X-XSRF-TOKEN'] = token
  }
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined
  if (!res.ok) {
    throw new ApiError(res.status, data?.code ?? 'ERROR', data?.detail ?? res.statusText, data?.errors ?? [])
  }
  return data as T
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}
