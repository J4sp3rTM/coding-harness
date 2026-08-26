/**
 * Keyless DuckDuckGo search over the HTML endpoint (`html.duckduckgo.com/html/`),
 * registered as `id: 'duckduckgo'` with `ctx.web`. The endpoint serves
 * server-rendered markup for a form POST and requires no credential, so the
 * provider is always `available()`; markup scraping is its own fragility (see
 * the package README's Known Limitations). Requests carry no credentials, but
 * redirects are still refused in the client so a response can never silently
 * move the request to another origin.
 * @module @deepseek-ai/dsh-web-search-duckduckgo/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '@deepseek-ai/dsh-web'
import { parseDuckDuckGoHtml } from './parser.ts'

/** Stable id this provider registers under. */
export const DUCKDUCKGO_PROVIDER_ID = 'duckduckgo'

/** Default HTML-endpoint base URL; the form action of the results page itself. */
export const DUCKDUCKGO_DEFAULT_BASE_URL = 'https://html.duckduckgo.com/html/'

/** Default response size cap, guarding against unbounded markup bodies. */
export const DUCKDUCKGO_DEFAULT_MAX_RESPONSE_BYTES = 2_000_000

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies every default). */
export interface DuckDuckGoSearchProviderOptions {
  /** HTML-endpoint base URL; the search form is POSTed here. */
  baseURL: string
  /** Inclusive response size cap in bytes; a larger body fails the operation. */
  maxResponseBytes: number
}

/** The keyless DuckDuckGo-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class DuckDuckGoSearchProvider implements WebSearchProvider {
  readonly id = DUCKDUCKGO_PROVIDER_ID

  constructor(private readonly options: DuckDuckGoSearchProviderOptions) {}

  /**
   * Always usable: the endpoint needs no credential, and configuration is
   * validated when the plugin registers the provider rather than per search.
   * @returns true unconditionally.
   */
  available(): boolean {
    return true
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    throwIfSearchAborted(signal)
    let response: Response
    try {
      response = await fetch(this.options.baseURL, {
        method: 'POST',
        // Refuse before following any redirect: the request target must stay
        // the configured endpoint even though this request carries no secret.
        redirect: 'error',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'accept': 'text/html',
          'user-agent': USER_AGENT,
        },
        body: new URLSearchParams({ q: request.query }).toString(),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`DuckDuckGo search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    // The form endpoint serves results only with HTTP 200. Anything else — a
    // 202 anomaly/challenge page, a rate limit, a gateway error — carries no
    // parseable results and is an error, not an empty result set (a 202 is
    // `response.ok`, so the status itself is checked).
    if (response.status !== 200) {
      await response.body?.cancel()
      throw new WebError(`DuckDuckGo returned HTTP ${response.status}`, 'WEB_PROVIDER_ERROR')
    }

    const html = await this.readCappedHtml(response, signal)
    return { sources: parseDuckDuckGoHtml(html), truncated: false }
  }

  /**
   * Read the response body up to {@link DuckDuckGoSearchProviderOptions.maxResponseBytes}
   * and decode it as UTF-8. A declared or actual body over the cap fails with
   * `WEB_FETCH_TOO_LARGE` instead of truncating: a cut-off page would parse
   * into silently wrong results.
   * @param response - the successful endpoint response.
   * @param signal - abort signal for the surrounding search.
   * @returns the decoded markup, byte-capped and BOM-stripped.
   */
  private async readCappedHtml(response: Response, signal?: AbortSignal): Promise<string> {
    const declared = response.headers.get('content-length')
    if (declared !== null) {
      const length = Number(declared)
      if (Number.isFinite(length) && length > this.options.maxResponseBytes) {
        await response.body?.cancel()
        throw new WebError(`DuckDuckGo response exceeds the maximum of ${this.options.maxResponseBytes} bytes`, 'WEB_FETCH_TOO_LARGE')
      }
    }

    /* v8 ignore next -- a 2xx Response from fetch always exposes a body stream; the null guard is defensive. */
    if (response.body === null) return ''
    const reader = response.body.getReader()
    // Keep a leading BOM visible so the explicit normalizer below owns that policy.
    const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
    let total = 0
    try {
      let html = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > this.options.maxResponseBytes) {
          throw new WebError(`DuckDuckGo response exceeds the maximum of ${this.options.maxResponseBytes} bytes`, 'WEB_FETCH_TOO_LARGE')
        }
        // Streaming decode keeps multibyte characters that straddle chunks intact.
        html += decoder.decode(value, { stream: true })
      }
      return stripByteOrderMark(html + decoder.decode())
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw error
    } finally {
      /* v8 ignore next 4 -- cancel() after a completed/broken read settles without rejecting; unobserved best-effort cleanup. */
      await reader.cancel().catch(() => {
        // Cancel after a completed read is best-effort cleanup; the markup we
        // need is already collected.
      })
    }
  }
}

/** Strip a leading UTF-8 byte-order mark left after decoding. */
function stripByteOrderMark(html: string): string {
  return html.startsWith('﻿') ? html.slice(1) : html
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('DuckDuckGo search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
