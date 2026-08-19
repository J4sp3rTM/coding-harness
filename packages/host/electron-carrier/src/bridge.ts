/**
 * Fetch ⇄ node:http adaptation for the Electron carrier.
 *
 * Every route the shipped web composition registers is written against
 * `IncomingMessage`/`ServerResponse`, because its carrier is a node:http
 * server. Electron's protocol handler speaks fetch `Request`/`Response`
 * instead. Rather than fork the routes, this module synthesizes the node pair
 * from a Request and resolves a Response as soon as the route commits its
 * status line — so a route that HOLDS the response open (SSE) streams
 * incrementally instead of buffering to completion.
 *
 * @module @deepseek-ai/dsh-host-electron-carrier/bridge
 */

import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** A synthesized node request/response pair plus the eventual fetch Response. */
export interface BridgedExchange {
  /** Route-facing request, carrying method, url, and headers. */
  req: IncomingMessage
  /** Route-facing response sink. */
  res: ServerResponse
  /**
   * Settles when the route commits its status line, NOT when it finishes:
   * an SSE route never finishes, and buffering it to completion would mean
   * the stream never reaches the renderer.
   */
  response: Promise<Response>
}

/** Header values as node hands them to a route. */
type NodeHeaders = Record<string, string | string[] | undefined>

/**
 * Collect a fetch Request's headers into node's lowercased bag, restated as
 * the in-process request it actually is.
 *
 * The `/api` trust fence downstream defends a NETWORK-REACHABLE HTTP server
 * from browser confused-deputy attacks: it reads `Host` to catch DNS rebinding
 * and `Origin`/`Sec-Fetch-Site` to catch cross-site posts. None of those
 * describe this carrier — there is no socket to rebind to and no third-party
 * page that can reach a scheme only this process serves — and the custom-scheme
 * values (`Host` absent, `Origin: dsh://app`) would read to that fence as an
 * untrusted authority.
 *
 * So the browser-relationship headers are restated to what is true here: the
 * caller is this process, over loopback, same-origin. The carrier's own
 * origin check ({@link ElectronWebServer.handle}) is what actually refuses a
 * foreign caller, and it runs before this.
 * @param request - the incoming protocol request.
 * @returns node-shaped headers.
 */
function nodeHeaders(request: Request): NodeHeaders {
  const headers: NodeHeaders = {}
  for (const [key, value] of request.headers) headers[key.toLowerCase()] = value
  headers.host = '127.0.0.1'
  delete headers.origin
  delete headers['sec-fetch-site']
  return headers
}

/**
 * Build the route-facing `IncomingMessage` over the request body.
 *
 * The body is piped in rather than buffered so an upload streams; `url` is
 * path-and-query only, matching what a node:http server reports.
 * @param request - the incoming protocol request.
 * @returns the synthesized request object.
 */
function incoming(request: Request): IncomingMessage {
  const url = new URL(request.url)
  const body = request.body === null
    ? Readable.from([])
    // Node accepts a web ReadableStream here and adapts it.
    : Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0])
  const message = body as unknown as IncomingMessage & { socket: unknown }
  message.method = request.method
  message.url = `${url.pathname}${url.search}`
  message.headers = nodeHeaders(request) as IncomingMessage['headers']
  message.httpVersion = '1.1'
  // Trust checks read the peer address. A custom-scheme request has no peer:
  // it originates inside this process, from our own renderer, so loopback is
  // the truthful answer rather than a convenient one.
  message.socket = { remoteAddress: '127.0.0.1', remotePort: 0 } as IncomingMessage['socket']
  return message
}

/**
 * Adapt one fetch Request into the node pair a route expects.
 *
 * The returned `response` promise resolves at the first header commit
 * (`writeHead`, `flushHeaders`, or the first `write`/`end`), handing back a
 * streaming body that stays open until the route calls `end`.
 * @param request - the incoming protocol request.
 * @returns the node pair and the eventual fetch Response.
 */
export function bridgeExchange(request: Request): BridgedExchange {
  const req = incoming(request)

  let status = 200
  const headers = new Headers()
  let committed = false
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let closed = false
  const pending: Uint8Array[] = []
  let settle: (response: Response) => void
  const response = new Promise<Response>((resolve) => { settle = resolve })

  const stream = new ReadableStream<Uint8Array>({
    start(source) {
      controller = source
      for (const chunk of pending) source.enqueue(chunk)
      pending.length = 0
      if (closed) source.close()
    },
    // The renderer navigated away or aborted: stop the route from writing
    // into a stream nobody reads.
    cancel() { closed = true },
  })

  const encoder = new TextEncoder()

  /** Emit one body chunk, buffering until the stream source exists. */
  const write = (chunk: unknown, encoding?: unknown): void => {
    if (closed) return
    if (chunk === undefined || chunk === null) return
    const bytes = typeof chunk === 'string'
      ? encoder.encode(chunk)
      : new Uint8Array(
        (chunk as Buffer).buffer,
        (chunk as Buffer).byteOffset,
        (chunk as Buffer).byteLength,
      )
    void encoding
    if (controller === undefined) {
      pending.push(bytes)
      return
    }
    controller.enqueue(bytes)
  }

  /** Publish the Response once, at the first header commit. */
  const commit = (): void => {
    if (committed) return
    committed = true
    settle(new Response(stream, { status, headers }))
  }

  const setHeader = (name: string, value: string | readonly string[]): void => {
    if (Array.isArray(value)) {
      headers.delete(name)
      for (const entry of value) headers.append(name, entry)
      return
    }
    headers.set(name, String(value))
  }

  const applyHeaderBag = (bag: unknown): void => {
    if (bag === undefined || bag === null || typeof bag !== 'object') return
    for (const [name, value] of Object.entries(bag as NodeHeaders)) {
      if (value === undefined) continue
      setHeader(name, value)
    }
  }

  // Mutable status/commit state lives in the closure rather than on the object:
  // routes assign `res.statusCode` directly, so the object's own property is the
  // source of truth for the code and `commit()` reads it at header time.
  const shim = {
    statusCode: 200,
    headersSent: false,

    writeHead(code: number, reasonOrHeaders?: unknown, maybeHeaders?: unknown) {
      status = code
      shim.statusCode = code
      applyHeaderBag(typeof reasonOrHeaders === 'string' ? maybeHeaders : reasonOrHeaders)
      shim.headersSent = true
      commit()
      return shim
    },

    setHeader(name: string, value: string | readonly string[]) {
      setHeader(name, value)
      return shim
    },

    getHeader(name: string) {
      return headers.get(name) ?? undefined
    },

    removeHeader(name: string) {
      headers.delete(name)
    },

    flushHeaders() {
      if (!shim.headersSent) status = shim.statusCode
      shim.headersSent = true
      commit()
    },

    write(chunk: unknown, encoding?: unknown, callback?: unknown) {
      if (!shim.headersSent) status = shim.statusCode
      shim.headersSent = true
      commit()
      write(chunk, encoding)
      if (typeof encoding === 'function') (encoding as () => void)()
      else if (typeof callback === 'function') (callback as () => void)()
      return true
    },

    end(chunk?: unknown, encoding?: unknown, callback?: unknown) {
      if (!shim.headersSent) status = shim.statusCode
      shim.headersSent = true
      commit()
      if (typeof chunk !== 'function') write(chunk, encoding)
      if (!closed) {
        closed = true
        controller?.close()
      }
      const done = [chunk, encoding, callback].find(value => typeof value === 'function')
      if (typeof done === 'function') (done as () => void)()
      return shim
    },

    // SSE routes call these; the protocol handler has no socket to tune.
    setTimeout() { return shim },
    on() { return shim },
    once() { return shim },
    off() { return shim },
    removeListener() { return shim },
    emit() { return false },
    destroy() {
      if (closed) return
      closed = true
      controller?.close()
    },
    get writableEnded() { return closed },
    get finished() { return closed },
  }
  const res = shim as unknown as ServerResponse

  return { req, res, response }
}
