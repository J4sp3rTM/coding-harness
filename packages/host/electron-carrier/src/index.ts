/**
 * @deepseek-ai/dsh-host-electron-carrier — the `webServer` service contract
 * carried over an Electron custom scheme instead of a listening socket.
 *
 * The shipped web composition registers its routes (the `/api` gateway, the
 * client plugin bundles, the dist fallback) against `ctx.webServer`. That
 * contract says nothing about TCP: it is a route table plus an index-transform
 * tap. This package provides the same service, so the desktop shell reuses
 * every one of those rows unchanged while opening no port at all — requests
 * arrive from our own renderer through `protocol.handle` and are answered in
 * process.
 *
 * What it deliberately does NOT carry is HTTP upgrade: a custom scheme has no
 * WebSocket. Upgrade registrations are accepted and recorded so the composing
 * rows still mount, but nothing dispatches to them; the desktop client reads
 * its event streams as SSE over the same fetch path instead (the transport the
 * abstract client already implements).
 *
 * @module @deepseek-ai/dsh-host-electron-carrier
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { bridgeExchange } from './bridge.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: ElectronWebServer
  }
}

/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' p matches p and p/<anything>. */
export type WebRouteKind = 'exact' | 'prefix'

/** One named route registration (the webserver contract, verbatim). */
export interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** One exact-path HTTP upgrade registration; recorded but never dispatched here. */
export interface WebUpgradeRoute {
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns protocol negotiation and the upgraded socket after dispatch. */
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

/**
 * The Electron carrier's route table.
 *
 * Mirrors `@deepseek-ai/dsh-host-webserver`'s service surface — same method
 * names, same duplicate-registration rules — so composition rows cannot tell
 * the two apart. `port`/`host` report the in-process facts: there is no
 * socket, and callers that print a URL should be configured not to.
 */
export class ElectronWebServer extends Service {
  private readonly exact = new Map<string, WebRoute>()
  private readonly prefixes = new Map<string, WebRoute>()
  private readonly upgrades = new Map<string, WebUpgradeRoute>()
  private readonly indexTaps: ((html: string) => string)[] = []
  private fallback: WebRoute['handler'] | undefined
  /** The one origin allowed to call in: the app's own window. */
  private readonly appOrigin: string

  constructor(ctx: Context, config?: { appOrigin?: string }) {
    super(ctx, 'webServer')
    this.appOrigin = config?.appOrigin ?? 'dsh://app'
  }

  /** No socket is bound; zero is the truthful port for an in-process carrier. */
  get port(): number {
    return 0
  }

  /** The in-process carrier answers only its own renderer. */
  get host(): string {
    return '127.0.0.1'
  }

  /**
   * Register a named route. Duplicate (kind, path) throws — route patterns are
   * a composition-level contract, so a collision is a misconfiguration.
   * @param route - kind, path, and the owning handler.
   * @returns the disposer removing the route.
   */
  register(route: WebRoute): () => void {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) {
      throw new Error(`electron-carrier: duplicate ${route.kind} route "${route.path}"`)
    }
    table.set(route.path, route)
    return () => { table.delete(route.path) }
  }

  /**
   * Accept an upgrade registration for contract parity. A custom scheme cannot
   * upgrade, so nothing dispatches here; the registration is recorded only so
   * the registering row mounts and disposes normally.
   * @param route - pathname and handler.
   * @returns the disposer removing the route.
   */
  registerUpgrade(route: WebUpgradeRoute): () => void {
    if (this.upgrades.has(route.path)) {
      throw new Error(`electron-carrier: duplicate upgrade route "${route.path}"`)
    }
    this.upgrades.set(route.path, route)
    return () => { this.upgrades.delete(route.path) }
  }

  /**
   * Claim the fallback seat: the handler answering every request no named
   * route matches (the SPA dist server).
   * @param handler - owns the full response lifecycle of unmatched requests.
   * @returns the disposer releasing the seat.
   */
  registerFallback(handler: WebRoute['handler']): () => void {
    if (this.fallback !== undefined) {
      throw new Error('electron-carrier: fallback already registered')
    }
    this.fallback = handler
    return () => { this.fallback = undefined }
  }

  /**
   * Register an index.html transform, applied by the fallback owner in
   * registration order.
   * @param transform - pure html-to-html function.
   * @returns the disposer removing the transform.
   */
  tapIndex(transform: (html: string) => string): () => void {
    this.indexTaps.push(transform)
    return () => {
      const at = this.indexTaps.indexOf(transform)
      if (at !== -1) this.indexTaps.splice(at, 1)
    }
  }

  /**
   * Apply the registered index transforms, in registration order.
   * @param html - the index document.
   * @returns the transformed document.
   */
  applyIndexTaps(html: string): string {
    return this.indexTaps.reduce((current, transform) => transform(current), html)
  }

  /**
   * Whether any upgrade route claims this path (diagnostics only).
   * @param path - pathname to probe.
   * @returns true when an upgrade route is registered for the path.
   */
  hasUpgrade(path: string): boolean {
    return this.upgrades.has(path)
  }

  /**
   * Resolve one pathname to its owning route: exact first, then the longest
   * matching prefix, so a specific registration always beats a broader one.
   * @param pathname - request pathname.
   * @returns the owning route, or undefined for the fallback.
   */
  private match(pathname: string): WebRoute | undefined {
    const exact = this.exact.get(pathname)
    if (exact !== undefined) return exact
    let best: WebRoute | undefined
    for (const [path, route] of this.prefixes) {
      if (pathname !== path && !pathname.startsWith(`${path}/`)) continue
      if (best === undefined || path.length > best.path.length) best = route
    }
    return best
  }

  /**
   * Answer one protocol request through the route table.
   *
   * This is the carrier's whole entry point: the desktop shell hands it every
   * request on the app scheme and returns what it resolves.
   * @param request - the fetch request from the protocol handler.
   * @returns the response, once the owning route commits its status line.
   */
  async handle(request: Request): Promise<Response> {
    // The desktop's whole trust rule, stated once and here: a request may come
    // from the app's own window and nowhere else. An Origin is attached by
    // anything script-initiated, so a page that somehow reached this scheme is
    // refused by name rather than by the network-shaped fence downstream,
    // which cannot judge a schemed origin. No Origin means a top-level
    // navigation or subresource load of our own document.
    const origin = request.headers.get('origin')
    if (origin !== null && origin !== this.appOrigin) {
      return new Response('forbidden', { status: 403 })
    }
    const pathname = new URL(request.url).pathname
    const route = this.match(pathname) ?? this.fallback
    if (route === undefined) return new Response('not found', { status: 404 })
    const handler = typeof route === 'function' ? route : route.handler
    const { req, res, response } = bridgeExchange(request)
    // The route owns the response lifecycle and may hold it open; await the
    // commit, not the completion, so streaming routes reach the renderer.
    const running = Promise.resolve(handler(req, res)).catch((error: unknown) => {
      this.ctx.logger.warn('electron-carrier: route "%s" failed: %s', pathname, String(error))
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
    void running
    return response
  }
}

export const name = 'host-electron-carrier'

/**
 * Provide the Electron-carried `webServer` service.
 * @param ctx - host context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(ElectronWebServer)
}
