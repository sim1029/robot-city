export interface MockedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
  bodyJson: () => unknown
}

export interface MockResponse {
  status?: number
  json?: unknown
  text?: string
  headers?: Record<string, string>
}

type Matcher = (req: MockedRequest) => boolean
type Handler = MockResponse | ((req: MockedRequest) => MockResponse | Promise<MockResponse>)

interface Stub {
  matcher: Matcher
  handler: Handler
  consumed: boolean
  once: boolean
}

const realFetch = globalThis.fetch
let stubs: Stub[] = []
let calls: MockedRequest[] = []
let installed = false

export function installFetchMock() {
  if (installed) return
  installed = true
  globalThis.fetch = (async (input: Parameters<typeof realFetch>[0], init?: Parameters<typeof realFetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = normalizeHeaders(init?.headers)
    const body = init?.body == null ? undefined : typeof init.body === 'string' ? init.body : String(init.body)
    const req: MockedRequest = {
      url,
      method,
      headers,
      body,
      bodyJson: () => (body === undefined ? undefined : JSON.parse(body)),
    }
    calls.push(req)

    const stub = stubs.find(s => !s.consumed && s.matcher(req))
    if (!stub) {
      throw new Error(`fetch-mock: no stub matched ${method} ${url}`)
    }
    if (stub.once) stub.consumed = true

    const result = typeof stub.handler === 'function' ? await stub.handler(req) : stub.handler
    return buildResponse(result)
  }) as typeof fetch
}

export function uninstallFetchMock() {
  globalThis.fetch = realFetch
  installed = false
  stubs = []
  calls = []
}

export function resetFetchMock() {
  stubs = []
  calls = []
}

export function mockFetch(matcher: Matcher | string | RegExp, handler: Handler, opts: { once?: boolean } = {}) {
  const fn: Matcher =
    typeof matcher === 'string' ? (r) => r.url === matcher
    : matcher instanceof RegExp ? (r) => matcher.test(r.url)
    : matcher
  stubs.push({ matcher: fn, handler, consumed: false, once: opts.once ?? false })
}

export function fetchCalls(): MockedRequest[] {
  return [...calls]
}

function normalizeHeaders(h: unknown): Record<string, string> {
  if (!h) return {}
  if (h instanceof Headers) {
    const out: Record<string, string> = {}
    h.forEach((v, k) => { out[k.toLowerCase()] = v })
    return out
  }
  if (Array.isArray(h)) {
    return Object.fromEntries((h as Array<[string, string]>).map(([k, v]) => [k.toLowerCase(), v]))
  }
  return Object.fromEntries(Object.entries(h as Record<string, unknown>).map(([k, v]) => [k.toLowerCase(), String(v)]))
}

function buildResponse(r: MockResponse): Response {
  const status = r.status ?? 200
  const headers = new Headers(r.headers ?? {})
  if (r.json !== undefined) {
    headers.set('content-type', headers.get('content-type') ?? 'application/json')
    return new Response(JSON.stringify(r.json), { status, headers })
  }
  return new Response(r.text ?? '', { status, headers })
}
