/**
 * Service Definition for the web access capability seam (`ctx.web`): registries and provider-selecting execution for search and
 * fetch. Duplicate ids are rejected. At execution time, resolution follows the configured
 * preference (single pin, ordered list, or auto-selection) and a usable provider must exist;
 * without one, auto-selection never depends on registration order.
 * @module @deepseek-ai/dsh-web
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from './types.ts'
import { WebError } from './types.ts'

export {
  WebError,
} from './types.ts'
export type {
  WebFetchBody,
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    web: WebRuntime
  }
}

/**
 * Config for the web seam. Precedence is explicit over implicit, one clear rule:
 * a single pinned id (`searchProvider` / `fetchProvider`, including its
 * `$DSH_WEB_*_PROVIDER` environment form) wins outright and the preference list
 * is ignored while a pin is set; the ordered list (`searchProviders` /
 * `fetchProviders`) applies only when no pin is set; auto-selection applies only
 * when neither is configured. Operational overrides such as environment
 * variables must feed these same fields rather than introduce a hidden priority
 * chain.
 */
export interface WebRuntimeConfig {
  /**
   * Explicit search provider id — the strongest pin. Omitted = the
   * `searchProviders` list applies; when that is also omitted, auto-select when
   * exactly one usable provider is registered.
   */
  readonly searchProvider?: string
  /**
   * Ordered search preference applied when no {@link searchProvider} pin is set.
   * Walked in order at execution time: the first registered AND available entry
   * wins; an entry that is registered but unavailable is skipped (that skipping
   * is the fallback behavior); an entry that is never registered fails with
   * `WEB_PROVIDER_CONFIGURED_MISSING` regardless of position; an exhausted list
   * fails with `WEB_PROVIDER_UNAVAILABLE`. An empty list means no preference —
   * the schema layer cannot distinguish it from an omitted field — and falls
   * through to auto-selection.
   */
  searchProviders?: string[]
  /**
   * Explicit fetch provider id — the strongest pin. Omitted = the
   * `fetchProviders` list applies; when that is also omitted, auto-select when
   * exactly one usable provider is registered.
   */
  readonly fetchProvider?: string
  /**
   * Ordered fetch preference, symmetric to {@link searchProviders} and applied
   * under the same rules when no {@link fetchProvider} pin is set. An empty
   * list means no preference and falls through to auto-selection.
   */
  fetchProviders?: string[]
}

/**
 * The web access service. Registered as `ctx.web` (one instance per context).
 *
 * Selection semantics (resolved at execution time):
 * - A pinned id (`searchProvider`/`fetchProvider`) that is registered and
 *   `available()` → that provider.
 * - A pinned id not registered → `WEB_PROVIDER_CONFIGURED_MISSING`.
 * - A pinned id registered but unavailable →
 *   `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` (a pin never falls back).
 * - No pin, a non-empty preference list → walk it in order: first registered
 *   and usable entry wins, unusable entries are skipped, any unregistered entry
 *   throws `WEB_PROVIDER_CONFIGURED_MISSING` (validated before the walk), and an
 *   exhausted list throws `WEB_PROVIDER_UNAVAILABLE`.
 * - Neither pin nor list, exactly one registered usable provider → that
 *   provider (never order-dependent).
 * - Neither pin nor list, multiple usable providers → `WEB_PROVIDER_AMBIGUOUS`.
 * - Neither pin nor list, no usable provider → `WEB_PROVIDER_UNAVAILABLE`.
 */
export class WebRuntime extends Service {
  /**
   * Provider selection config. Operational env overrides feed the SAME fields:
   * `$DSH_WEB_SEARCH_PROVIDER` / `$DSH_WEB_FETCH_PROVIDER` are equivalent to
   * `searchProvider` / `fetchProvider` and are NOT a hidden priority chain.
   */
  static Config: z<WebRuntimeConfig> = z.object({
    searchProvider: z.string(),
    searchProviders: z.array(z.string()),
    fetchProvider: z.string(),
    fetchProviders: z.array(z.string()),
  })

  private searchProviders = new Map<string, WebSearchProvider>()
  private fetchProviders = new Map<string, WebFetchProvider>()
  private readonly searchPinId: string | undefined
  private readonly searchPreferenceIds: readonly string[] | undefined
  private readonly fetchPinId: string | undefined
  private readonly fetchPreferenceIds: readonly string[] | undefined

  constructor(ctx: Context, config: WebRuntimeConfig = {}) {
    super(ctx, 'web')
    this.searchPinId = config.searchProvider ?? process.env.DSH_WEB_SEARCH_PROVIDER
    this.searchPreferenceIds = normalizePreference(config.searchProviders)
    this.fetchPinId = config.fetchProvider ?? process.env.DSH_WEB_FETCH_PROVIDER
    this.fetchPreferenceIds = normalizePreference(config.fetchProviders)
  }

  /**
   * Register a search provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for search. Returns a disposer; disposed
   * with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerSearchProvider(provider: WebSearchProvider): () => void {
    return this.registerProvider(this.searchProviders, provider)
  }

  /**
   * Register a fetch provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for fetch. Returns a disposer; disposed
   * with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerFetchProvider(provider: WebFetchProvider): () => void {
    return this.registerProvider(this.fetchProviders, provider)
  }

  private registerProvider<P extends { readonly id: string }>(store: Map<string, P>, provider: P): () => void {
    if (store.has(provider.id)) {
      throw new WebError(`a web provider with id "${provider.id}" is already registered`, 'WEB_DUPLICATE_PROVIDER')
    }
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      yield () => store.delete(provider.id)
    }, 'web.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Run one search through the selected provider. Resolves the provider at call
   * time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. The seam enforces `request.maxResults` on the result:
   * if the provider over-returns, `sources[]` is truncated and `truncated` set.
   * @param request - the query and optional result limit.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the provider's results, capped to `request.maxResults`.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const provider = resolveProvider(this.searchProviders, this.searchPinId, this.searchPreferenceIds)
    const result = await provider.search(request, signal)
    return capSources(result, request.maxResults)
  }

  /**
   * Retrieve one URL through the selected provider. Resolves the provider at
   * call time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. A non-2xx response is a result, not a throw.
   * @param request - the URL plus retrieval options.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the retrieval outcome; non-2xx responses resolve descriptively.
   */
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const provider = resolveProvider(this.fetchProviders, this.fetchPinId, this.fetchPreferenceIds)
    return provider.fetch(request, signal)
  }
}

interface ResolvableProvider {
  readonly id: string
  available(): boolean
}

/**
 * Normalize a preference list: the schema layer resolves an omitted array field
 * to `[]`, so an empty list is indistinguishable from an absent one — both mean
 * "no preference" and fall through to auto-selection.
 * @param ids - the configured list, already schema-resolved.
 * @returns the non-empty list, or `undefined` when absent or empty.
 */
function normalizePreference(ids: readonly string[] | undefined): readonly string[] | undefined {
  return ids !== undefined && ids.length > 0 ? ids : undefined
}

/**
 * Resolve the selected provider or throw the matching {@link WebError}. The pin
 * wins outright; the ordered preference list applies only without a pin; the
 * order-independent auto-selection applies only with neither. The list's
 * presence check covers every entry before the availability walk, so a typo in
 * any position fails loudly regardless of which entries are usable today.
 */
function resolveProvider<P extends ResolvableProvider>(
  providers: ReadonlyMap<string, P>,
  configuredId: string | undefined,
  preferredIds: readonly string[] | undefined,
): P {
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new WebError(`configured web provider "${configuredId}" is not registered`, 'WEB_PROVIDER_CONFIGURED_MISSING')
    }
    if (!provider.available()) {
      throw new WebError(`configured web provider "${configuredId}" is registered but unavailable`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    return provider
  }
  if (preferredIds !== undefined) {
    for (const id of preferredIds) {
      if (!providers.has(id)) {
        throw new WebError(`configured web provider "${id}" is not registered`, 'WEB_PROVIDER_CONFIGURED_MISSING')
      }
    }
    for (const id of preferredIds) {
      const provider = providers.get(id)
      if (provider?.available() === true) return provider
    }
    const ids = preferredIds.map(id => `"${id}"`).join(', ')
    throw new WebError(`every configured web provider (${ids}) is registered but unavailable`, 'WEB_PROVIDER_UNAVAILABLE')
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new WebError('no usable web provider is registered', 'WEB_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new WebError(`multiple usable web providers are registered (${ids}); configure one explicitly`, 'WEB_PROVIDER_AMBIGUOUS')
  }
  return single
}

/** Enforce `maxResults` on a search result: truncate `sources[]` and flag it. */
function capSources(result: WebSearchResult, maxResults: number | undefined): WebSearchResult {
  if (maxResults === undefined || result.sources.length <= maxResults) return result
  return { ...result, sources: result.sources.slice(0, maxResults), truncated: true }
}

export default WebRuntime
