/**
 * Desktop API carrier: the whole protocol over one custom-scheme fetch.
 *
 * The browser carrier splits itself in two because browsers must — a same-origin
 * WebSocket is the only way to hold an event downlink open reliably. A custom
 * Electron scheme has no WebSocket at all, but it also has no need for one:
 * requests are answered in process, so the abstract client's own SSE-over-fetch
 * downlink (`readSse`) is the whole transport. That is why this subclass
 * overrides nothing but `doFetch` — `openMux`/`openHost` are deliberately left
 * on the base implementation.
 */

import { AbstractApiClient } from './api.ts'

/** Desktop platform subclass: every quadrant rides one in-process fetch. */
export class ElectronApiClient extends AbstractApiClient {
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(input, init)
  }
}
