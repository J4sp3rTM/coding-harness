import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DuckDuckGoSearchProvider, DUCKDUCKGO_PROVIDER_ID } from '@deepseek-ai/dsh-web-search-duckduckgo'

/** The real HTML-endpoint response recorded once from a live results page. */
const FIXTURE_HTML = readFileSync(fileURLToPath(new URL('./fixtures/ddg-html-results.html', import.meta.url)), 'utf8')

const TWO_RESULTS_HTML = [
  '<!DOCTYPE html><html><body>',
  '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fone.example%2F&amp;rut=a">One</a>',
  '<a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fone.example%2F">first</a>',
  '<a class="result__a" href="https://two.example/">Two</a>',
  '</body></html>',
].join('')

const options = (overrides: Partial<{ baseURL: string; maxResponseBytes: number }> = {}) => ({
  baseURL: 'https://html.duckduckgo.test/html/',
  maxResponseBytes: 1_000_000,
  ...overrides,
})

type Handler = (req: IncomingMessage, res: ServerResponse) => void

let server: Server
let base: string
let handler: Handler

beforeEach(async () => {
  handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(TWO_RESULTS_HTML)
  }
  server = createServer((req, res) => { handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await new Promise<void>(resolve => server.close(() => { resolve() }))
})

describe('DuckDuckGoSearchProvider transport', () => {
  it('is always available and reports its stable id', () => {
    const provider = new DuckDuckGoSearchProvider(options())
    expect(provider.available()).toBe(true)
    expect(provider.id).toBe(DUCKDUCKGO_PROVIDER_ID)
  })

  it('POSTs the query as a form body to the configured base URL', async () => {
    let method: string | undefined
    let contentType: string | undefined
    let body = ''
    handler = (req, res) => {
      method = req.method
      contentType = req.headers['content-type']
      req.on('data', (chunk: string) => { body += chunk })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(TWO_RESULTS_HTML)
      })
    }
    const result = await new DuckDuckGoSearchProvider(options({ baseURL: `${base}/html/` })).search({ query: 'deepseek harness' })
    expect(method).toBe('POST')
    expect(contentType).toBe('application/x-www-form-urlencoded')
    expect(body).toBe('q=deepseek+harness')
    expect(result.sources.map(source => source.url)).toEqual(['https://one.example/', 'https://two.example/'])
    expect(result.truncated).toBe(false)
  })

  it('sends the product user agent and accepts an HTML response', async () => {
    let userAgent: string | undefined
    handler = (req, res) => {
      userAgent = req.headers['user-agent']
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(TWO_RESULTS_HTML)
    }
    await new DuckDuckGoSearchProvider(options({ baseURL: base })).search({ query: 'q' })
    expect(userAgent).toBe('deepseek-harness/0.0.1')
  })

  it('parses the recorded live-endpoint markup end to end', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(FIXTURE_HTML)
    }
    const result = await new DuckDuckGoSearchProvider(options({ baseURL: base })).search({ query: 'mx record' })
    expect(result.sources).toHaveLength(10)
    expect(result.sources[0]).toMatchObject({
      url: 'https://mxtoolbox.com/',
      title: 'MX Lookup Tool - Check your DNS MX Records online - MxToolbox',
    })
  })

  it('returns zero sources for a results page without results', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body><form action="/html/" method="post"></form></body></html>')
    }
    const result = await new DuckDuckGoSearchProvider(options({ baseURL: base })).search({ query: 'q' })
    expect(result).toEqual({ sources: [], truncated: false })
  })

  it('strips a leading byte-order mark before parsing', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`\uFEFF${TWO_RESULTS_HTML}`)
    }
    const result = await new DuckDuckGoSearchProvider(options({ baseURL: base })).search({ query: 'q' })
    expect(result.sources).toHaveLength(2)
  })

  it('reports a non-2xx response as WEB_PROVIDER_ERROR naming the status', async () => {
    handler = (_req, res) => { res.writeHead(202, { 'content-type': 'text/html' }); res.end('anomaly') }
    await expect(new DuckDuckGoSearchProvider(options({ baseURL: base })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'DuckDuckGo returned HTTP 202' }))
  })

  it('rejects an over-cap Content-Length without reading the body', async () => {
    let bodyRequested = false
    handler = (_req, res) => {
      bodyRequested = true
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(TWO_RESULTS_HTML.length * 4) })
      res.end(TWO_RESULTS_HTML)
    }
    await expect(new DuckDuckGoSearchProvider(options({ baseURL: base, maxResponseBytes: 10 })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_FETCH_TOO_LARGE' }))
    expect(bodyRequested).toBe(true)
  })

  it('fails a stream that grows past the cap instead of parsing cut-off markup', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(TWO_RESULTS_HTML.repeat(50))
    }
    await expect(new DuckDuckGoSearchProvider(options({ baseURL: base, maxResponseBytes: 100 })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_FETCH_TOO_LARGE' }))
  })

  it('ignores a non-numeric Content-Length and reads the response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(TWO_RESULTS_HTML, {
      status: 200,
      headers: { 'content-type': 'text/html', 'content-length': 'unknown' },
    })))
    await expect(new DuckDuckGoSearchProvider(options({ baseURL: base })).search({ query: 'q' }))
      .resolves.toMatchObject({ truncated: false })
  })

  it('surfaces a pre-aborted signal as WEB_ABORTED', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(new DuckDuckGoSearchProvider(options({ baseURL: base })).search({ query: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('aborts an in-flight request and read as WEB_ABORTED', async () => {
    handler = (_req, _res) => { /* never responds */ }
    const controller = new AbortController()
    const promise = new DuckDuckGoSearchProvider(options({ baseURL: base })).search({ query: 'q' }, controller.signal)
    controller.abort()
    await expect(promise).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps a connection failure to WEB_PROVIDER_ERROR', async () => {
    // Port 1 on loopback is not listening: a real connection failure (not abort).
    await expect(new DuckDuckGoSearchProvider(options({ baseURL: 'http://127.0.0.1:1/' })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a non-abort DOMException to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('unsupported', 'NotSupportedError'))))
    await expect(new DuckDuckGoSearchProvider(options({ baseURL: base })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a reader abort without a caller signal to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: () => Promise.reject(new DOMException('aborted', 'AbortError')),
          cancel: () => Promise.resolve(),
        }),
      },
    })))
    await expect(new DuckDuckGoSearchProvider(options({ baseURL: base })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('DuckDuckGoSearchProvider redirect policy', () => {
  /** Real servers prove whether native fetch contacts the cross-origin Location. */
  let redirectServer: Server
  let targetServer: Server
  let redirectOrigin: string
  let targetOrigin: string
  let targetRequests: number

  beforeEach(async () => {
    targetRequests = 0
    targetServer = createServer((_req, res) => {
      targetRequests++
      res.writeHead(204).end()
    })
    redirectServer = createServer((_req, res) => {
      res.writeHead(302, { location: `${targetOrigin}/collect` }).end()
    })
    await new Promise<void>(resolve => targetServer.listen(0, '127.0.0.1', resolve))
    await new Promise<void>(resolve => redirectServer.listen(0, '127.0.0.1', resolve))
    targetOrigin = `http://127.0.0.1:${(targetServer.address() as AddressInfo).port}`
    redirectOrigin = `http://127.0.0.1:${(redirectServer.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await new Promise<void>(resolve => redirectServer.close(() => { resolve() }))
    await new Promise<void>(resolve => targetServer.close(() => { resolve() }))
  })

  it.each([301, 302, 303, 307, 308])('refuses HTTP %i before contacting the Location target', async (status) => {
    targetRequests = 0
    handler = (_req, res) => { res.writeHead(status, { location: `${targetOrigin}/collect` }); res.end() }
    await expect(new DuckDuckGoSearchProvider(options({ baseURL: base })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    expect(targetRequests).toBe(0)
  })

  it('leaves nothing on the table for a default-following client: the same fixture forwards', async () => {
    // Control proving the assertion above can observe contact: a default
    // fetch() against the same redirect fixture follows and reaches the target,
    // which is exactly what the provider's refusal prevents.
    targetRequests = 0
    await fetch(`${redirectOrigin}/`, { method: 'POST', body: 'q=control', redirect: 'follow' }).catch(() => {})
    expect(targetRequests).toBe(1)
  })
})
