/**
 * Register the keyless DuckDuckGo search provider in `ctx.web`. The provider
 * queries DuckDuckGo's HTML endpoint with a form POST and needs no credential,
 * which is what makes it usable as the ordered fallback behind a credentialed
 * search provider.
 * @module @deepseek-ai/dsh-web-search-duckduckgo
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  DUCKDUCKGO_DEFAULT_BASE_URL,
  DUCKDUCKGO_DEFAULT_MAX_RESPONSE_BYTES,
  DuckDuckGoSearchProvider,
} from './provider.ts'

export {
  DUCKDUCKGO_DEFAULT_BASE_URL,
  DUCKDUCKGO_DEFAULT_MAX_RESPONSE_BYTES,
  DUCKDUCKGO_PROVIDER_ID,
  DuckDuckGoSearchProvider,
} from './provider.ts'
export type { DuckDuckGoSearchProviderOptions } from './provider.ts'
export { decodeEntities, parseDuckDuckGoHtml, resolveTargetUrl, stripMarkup } from './parser.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-duckduckgo'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config: where to ask and how much markup to accept. No keys exist. */
export interface Config {
  /** HTML-endpoint base URL; the search form is POSTed here. */
  baseURL?: string
  /** Inclusive response size cap in bytes; larger bodies fail the operation. */
  maxResponseBytes?: number
}

export const Config: z<Config> = z.object({
  baseURL: z.string().default(DUCKDUCKGO_DEFAULT_BASE_URL),
  maxResponseBytes: z.number().step(1).min(1).default(DUCKDUCKGO_DEFAULT_MAX_RESPONSE_BYTES),
})

/** Register the keyless DuckDuckGo search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  // Schema defaults cover the Loader path; direct callers may bypass that
  // parse, so every field is re-validated here and misconfiguration fails loud.
  const baseURL = config.baseURL ?? DUCKDUCKGO_DEFAULT_BASE_URL
  if (!URL.canParse(baseURL)) {
    throw new Error(`web-search-duckduckgo: config.baseURL "${baseURL}" is not a parsable URL`)
  }
  const maxResponseBytes = config.maxResponseBytes ?? DUCKDUCKGO_DEFAULT_MAX_RESPONSE_BYTES
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new Error(`web-search-duckduckgo: config.maxResponseBytes must be a positive integer, got ${maxResponseBytes}`)
  }
  ctx.web.registerSearchProvider(new DuckDuckGoSearchProvider({ baseURL, maxResponseBytes }))
}
