/**
 * Generic pi-ai-backed LLM adapter plugin. One plugin instance owns a dict of
 * provider routes; a route naming an installed pi-ai provider inherits that
 * provider's endpoint, protocol, and model catalog as defaults, and a route
 * pi-ai does not ship is declared outright. Profile facts resolve per request
 * over the optional `llm-pi-ai` user-settings section and the optional
 * credential seam, so a changed key, endpoint, model, or knob reaches the next
 * request without a restart; a changed *route set* (or a route's
 * registration-captured retry policy) re-registers the same adapter instance
 * in place.
 *
 * ```yaml
 * - id: llm
 *   name: '@deepseek-ai/dsh-llm-pi-ai'
 *   config:
 *     providers:
 *       # Catalog route: everything but the credential comes from pi-ai.
 *       openai:
 *         apiKeyEnv: OPENAI_API_KEY
 *         retryPolicy:
 *           mode: normal
 *           maxRetries: 2
 *       # Catalog route with the catalog narrowed and one capacity corrected.
 *       anthropic:
 *         apiKeyEnv: ANTHROPIC_API_KEY
 *         models:
 *           - id: claude-sonnet-4-5
 *             contextWindow: 200000
 *       # Hand-declared route: pi-ai ships nothing under this key.
 *       acme-gateway:
 *         displayName: Acme Gateway
 *         apiKeyEnv: ACME_GATEWAY_API_KEY
 *         api: openai-completions
 *         baseURL: https://gateway.acme.example/v1
 *         # Reasoning dialect for a URL pi-ai cannot recognize.
 *         compat:
 *           thinkingFormat: deepseek
 *         models:
 *           - id: acme-large
 *             name: Acme Large
 *             contextWindow: 65536
 *             maxTokens: 4096
 *           - id: acme-think
 *             name: Acme Think
 *             contextWindow: 262144
 *             maxTokens: 32768
 *             # key = selectable level, value = wire spelling; only off may
 *             # leave the value empty (supported, send nothing).
 *             reasoningEfforts:
 *               off:
 *               high: high
 *               max: ultra
 * ```
 *
 * @module @deepseek-ai/dsh-llm-pi-ai
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type { LlmOAuthTokenStore } from '@deepseek-ai/dsh-llm-oauth'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { PiAiAdapter } from './adapter.ts'
import type { PiAiRequestAuth } from './adapter.ts'
import { catalogProviderIds, catalogProviderTakesApiKey, catalogProviderTakesOAuth } from './catalog.ts'
import { assertServiceable, Config, resolveProfiles } from './config.ts'
import type { PiAiProviderProfile, ResolvedPiAiProviderProfile } from './config.ts'
import { discoverModels } from './discovery.ts'

export { PiAiAdapter } from './adapter.ts'
export type { PiAiAdapterOptions, PiAiRequestAuth } from './adapter.ts'
export { Config } from './config.ts'
export type {
  PiAiAuthMode,
  PiAiCompatProfile,
  PiAiModality,
  PiAiModelOverride,
  PiAiModelProfile,
  PiAiProviderProfile,
  PiAiReasoningEfforts,
  PiAiThinkingFormat,
  ResolvedPiAiProviderProfile,
} from './config.ts'
export { supportedProtocols } from './provider.ts'

export const name = 'llm-pi-ai'
// The sign-in seam is deliberately absent here: an api-key-only deployment
// composes none, and a route that needs one must fail its own request rather
// than keep this adapter from mounting. It is read per request through
// `ctx.get('llmOAuth')`, which also lets a sign-in service mounted after this
// plugin reach the routes already registered.
export const inject = ['llm']

const NS = settingsNamespace('llm-pi-ai')

/**
 * The registry captures these per route; a change here must re-register.
 * Sorted by provider so a settings document that merely reorders its keys is
 * not mistaken for a route change.
 */
function registrationFacts(profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>): unknown {
  return [...profiles.entries()]
    // `displayName` rides along because the registry hands it to every selector
    // through `providerInfo()`: a rename that did not re-register would leave
    // the old label showing until some unrelated fact happened to change.
    .map(([provider, profile]) => ({
      provider,
      displayName: profile.displayName,
      retryPolicy: profile.retryPolicy,
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider))
}

/**
 * The configurable-provider directory: every installed catalog route this
 * adapter can authenticate, plus every route the current profiles declare. A
 * hand-declared route has no catalog entry, so without this union it would
 * have no settings address and configuration surfaces could neither show nor
 * edit it.
 *
 * The profile half is unconditional, which is what keeps a route already
 * stored against a withheld provider editable and deletable rather than
 * stranded in the settings document with nothing on the page to remove it.
 * @param profiles - the currently resolved provider profiles.
 * @returns the directory entries in catalog order, declared routes last.
 */
function directoryEntries(
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>,
): LlmConfigurableProvider[] {
  const catalog = new Set(catalogProviderIds())
  const entries = new Map<string, LlmConfigurableProvider>()
  const declare = (provider: string, displayName: string): void => {
    entries.set(provider, {
      provider,
      displayName,
      settingsNs: NS,
      settingsPath: ['providers', provider],
      // Membership of the installed catalog, not of the settings document:
      // narrowing a shipped provider's models stores a profile too, and that
      // route is still one pi-ai knows.
      declared: !catalog.has(provider),
    })
  }
  // A provider this adapter can authenticate by neither method leaves nothing
  // to configure, so offering it would put a card on the settings page whose
  // own posture — no key, credentials discovered by the provider — fails every
  // request. A subscription route qualifies through the sign-in seam even
  // though it takes no key, which is what puts `openai-codex` on the page.
  // Catalog *membership* is unaffected, so `declare` above still answers what
  // pi-ai ships.
  for (const provider of catalog) {
    if (catalogProviderTakesApiKey(provider) || catalogProviderTakesOAuth(provider)) declare(provider, provider)
  }
  for (const [provider, profile] of profiles) declare(provider, profile.displayName)
  return [...entries.values()]
}

/** Register one generic pi-ai adapter for all configured provider routes. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let memoized: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  /**
   * The routes a sign-in currently authenticates, as a synchronous view.
   *
   * Profile resolution is synchronous and runs on every operation, while the
   * token store is asynchronous, so the set is refreshed on the seam's commit
   * event rather than read per resolve. The version counter is what the
   * profile memo keys on: a sign-in changes the route set without changing the
   * settings document, and without it the memo would keep serving the route
   * set from before.
   */
  let signedInRoutes: ReadonlySet<string> = new Set()
  let signedInVersion = 0
  let memoizedVersion = -1
  /**
   * The resolved profiles for the current configuration, memoized by the raw
   * snapshot's identity — which is also what makes the adapter's own snapshot
   * stable across operations that observe no change.
   *
   * No fallback for an unserviceable snapshot lives here: the section schema
   * resolves the whole profile set, so a write that could not be served is
   * refused where it is written, and the settings seam keeps a namespace's
   * last good value for a stored section that fails. Anything reaching this
   * point has already resolved once.
   */
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const raw = current()
    if (raw === lastRaw && signedInVersion === memoizedVersion && memoized !== undefined) return memoized
    const next = resolveProfiles({ ...raw.providers, ...adoptedRoutes(raw) })
    lastRaw = raw
    memoizedVersion = signedInVersion
    memoized = next
    return next
  }

  /**
   * Catalog routes this deployment serves because they are signed in.
   *
   * Signing in is the whole configuration a subscription route needs: its
   * endpoint, protocol, and model catalog all come from the installed catalog,
   * and its credential comes from the sign-in. Requiring a settings profile on
   * top would mean a user who completed a browser sign-in still saw no models
   * until they went and wrote the route's name in a file, which is a
   * configuration step with nothing left to configure.
   *
   * A route the settings document already names is left alone — the profile is
   * the deployment's own answer for it, including a deliberate `auth: api-key`
   * — and a route pi-ai cannot sign into is never adopted, so a stale token for
   * a provider this build dropped disappears rather than failing every request.
   * @param raw - the current configuration, whose routes are already served.
   * @returns synthetic profiles for the signed-in routes nothing configures.
   */
  const adoptedRoutes = (raw: Config): Record<string, PiAiProviderProfile> => {
    const configured = raw.providers ?? {}
    const adopted: Record<string, PiAiProviderProfile> = {}
    for (const provider of signedInRoutes) {
      if (provider in configured) continue
      if (!catalogProviderTakesOAuth(provider)) continue
      adopted[provider] = { auth: 'subscription' }
    }
    return adopted
  }

  /** The subscription token store, when a sign-in service is composed and live. */
  const resolveTokens = (): LlmOAuthTokenStore | undefined => ctx.get('llmOAuth')?.tokens()

  /** Whether a route currently holds a stored subscription token set. */
  const signedIn = async (provider: string): Promise<boolean> =>
    await resolveTokens()?.read(provider) !== undefined

  const resolveApiKey = async (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
  ): Promise<string | undefined> => {
    const ref = profile.apiKeyEnv
    // Only a profile that names no credential at all defers to pi-ai's
    // provider-native discovery. Once one is named, a miss must fail loud:
    // handing pi-ai `undefined` would let it pick up an unrelated ambient key
    // (OPENAI_API_KEY and friends), billing another tenant for a request the
    // deployment meant to authenticate differently.
    if (ref === undefined) return undefined
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      // Without the seam the environment is the whole credential plane.
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, 'llm-pi-ai', ref)
    throw new LlmError(
      `llm-pi-ai: no credential for provider route "${provider}"; its profile resolves ${ref}, which is not`
      + ` set — store ${ref} through the credentials service (the web Models page writes it) or export it,`
      + ' and remove apiKeyEnv only if this provider should authenticate from pi-ai\'s own environment discovery',
      'MISSING_CREDENTIAL',
    )
  }

  /**
   * Decide how one route authenticates its next request.
   *
   * The three postures are decided here rather than inside the adapter because
   * only this fiber can see the sign-in seam and the credential seam at once.
   * A profile naming `subscription` never falls through to a key: the fallback
   * would silently move the request onto whatever ambient key the environment
   * carries, which is the one outcome a user putting work on their plan did not
   * ask for. A profile naming nothing lets a stored sign-in own the route,
   * which makes signing in sufficient and signing out reversible.
   */
  const resolveAuth = async (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
  ): Promise<PiAiRequestAuth> => {
    if (profile.auth === 'subscription') {
      if (await signedIn(provider)) return { subscription: true }
      throw new LlmError(
        `llm-pi-ai: provider route "${provider}" is configured for subscription sign-in, and nobody is signed`
        + ` in — run "/login ${provider}", or set auth: api-key with an apiKeyEnv reference to use a key`,
        'MISSING_SUBSCRIPTION',
      )
    }
    if (profile.auth === undefined && await signedIn(provider)) return { subscription: true }
    const apiKey = await resolveApiKey(provider, profile)
    return { subscription: false, ...apiKey === undefined ? {} : { apiKey } }
  }

  const adapter = new PiAiAdapter({
    profiles,
    resolveAuth,
    resolveTokens,
    resolveAttachments: () => ctx.get('attachments'),
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(
        `llm-pi-ai: unusable replay state on assistant history for route "${provider}/${model}";`
        + ` sending that message as provider-neutral content (${reason})`,
      )
    },
  })
  // The full installed catalog is configurable from the moment the plugin
  // mounts — dormant or not — so configuration surfaces can offer every
  // pi-ai provider before any route exists. Hand-declared routes join it as
  // profiles appear, and leave with them.
  let directory: DirectoryRegistrationHandle | undefined
  let directoryFacts: unknown
  const ensureDirectory = (): void => {
    const entries = directoryEntries(profiles())
    if (deepEqualJson(entries, directoryFacts)) return
    // Atomic replace, never dispose-then-register: a route another adapter
    // family already declares (a profile keyed `deepseek-official`) would
    // otherwise leave this plugin's whole directory withdrawn and the Models
    // page empty. The candidate set is validated first, so a collision keeps
    // the previous entries serving and only costs a diagnostic.
    if (directory === undefined) {
      directory = ctx.llm.registerConfigurableProviders(entries)
    } else {
      directory.replace(entries)
    }
    directoryFacts = entries
  }
  ensureDirectory()
  /**
   * The credential a named route already resolves, for an interrogation whose
   * draft carries none. A route being declared for the first time names no
   * profile yet, and a profile that names no credential defers to pi-ai's own
   * discovery, so both answer `undefined` and the endpoint is asked
   * unauthenticated — the same posture a request to that route would take.
   */
  const storedApiKey = async (provider: string | undefined): Promise<string | undefined> => {
    if (provider === undefined) return undefined
    const profile = profiles().get(provider)
    if (profile === undefined) return undefined
    return resolveApiKey(provider, profile)
  }
  // Interrogating an endpoint is a configuration-time action over a draft, so
  // it is offered for the whole namespace rather than per route: the provider
  // a surface is adding does not exist yet. The draft is the whole request
  // except the credential: a configuration surface edits a redacted descriptor
  // and never holds a stored secret, so an already-configured route supplies
  // its own here rather than being interrogated unauthenticated.
  ctx.llm.registerModelDiscovery(NS, request => discoverModels(request, () => storedApiKey(request.provider)))
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below. A bare
  // mount (zero routes) is the dormant posture: nothing registers until a
  // settings section supplies profiles, and routes drop when it empties.
  let registration: AdapterRegistrationHandle | undefined
  let registeredFacts: unknown
  const ensureRegistrationFacts = (): void => {
    const facts = registrationFacts(profiles())
    if (deepEqualJson(facts, registeredFacts)) return
    // The registry captures the route set and each route's retry policy at
    // registration, so a change to either must re-register. The swap is
    // atomic (same adapter instance, validated before anything moves): a
    // conflicting route leaves the previous routes serving requests, and
    // `registeredFacts` only advances once the registry actually holds the
    // new set — so returning to a working configuration always re-applies.
    const routes = [...profiles().keys()]
    if (registration === undefined) {
      // Dormant bare mount: nothing is registered until a section supplies
      // profiles, and an empty section keeps it that way.
      if (routes.length === 0) {
        registeredFacts = facts
        return
      }
      registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredFacts = facts
  }
  ensureRegistrationFacts()

  /**
   * Re-read which routes a sign-in authenticates and re-register when the set
   * moved. Registration and the configurable-provider directory both capture
   * the route set, so adopting or dropping a route has to reach them the same
   * way a settings change does.
   */
  let reportedOnce = false
  const refreshSignedIn = async (): Promise<void> => {
    const tokens = resolveTokens()
    const next = new Set(tokens === undefined ? [] : await tokens.list())
    const changed = next.size !== signedInRoutes.size || [...next].some(route => !signedInRoutes.has(route))
    if (changed) {
      signedInRoutes = next
      signedInVersion += 1
      try {
        ensureRegistrationFacts()
        ensureDirectory()
      } catch (error) {
        ctx.logger.error('llm-pi-ai: keeping the previous routes after a refused subscription update')
        ctx.logger.error(error)
      }
    }
    // The startup report is the point of the first pass even when nothing
    // moved: a tree with no routes at all is exactly the state users arrive
    // asking about, and it changes nothing by definition.
    if (!changed && reportedOnce) return
    reportedOnce = true
    reportRoutes()
  }
  // A sign-in or sign-out in THIS process; an external one (another harness
  // process, a terminal sign-in) reaches a running tree on its next start.
  ctx.on('llm-oauth/updated', () => { void refreshSignedIn() })

  /**
   * One line per provider route at startup and after every route change, plus
   * the one diagnosis this adapter can make that a user cannot: a subscription
   * that is signed in but serves no models. Written at info level because the
   * absence of a provider is the question users actually arrive with, and it
   * has no other visible symptom.
   */
  function reportRoutes(): void {
    const resolved = profiles()
    const signedInList = [...signedInRoutes].sort()
    ctx.logger.info('llm-pi-ai: subscription sign-ins: %s',
      signedInList.length === 0 ? '(none)' : signedInList.join(', '))
    if (resolved.size === 0) {
      ctx.logger.info('llm-pi-ai: no provider routes registered'
        + ' — sign in with /login, or add a provider on the Models settings page')
      return
    }
    for (const [provider, profile] of resolved) {
      const auth = profile.auth ?? (signedInRoutes.has(provider) ? 'subscription (adopted)' : 'api-key')
      const models = profile.piProvider.getModels().length
      ctx.logger.info('llm-pi-ai: route %s — auth %s, %s model(s)', provider, auth, String(models))
    }
    for (const provider of signedInList) {
      if (resolved.has(provider)) continue
      ctx.logger.warn('llm-pi-ai: "%s" is signed in but serves no models here;'
        + ' this build\'s catalog offers no subscription for that route', provider)
    }
  }

  // The store is asynchronous and this fiber is not, so the first read lands
  // after mount: the tree is already serving the configured routes, and an
  // adopted one joins them a tick later.
  ctx.effect(() => {
    void refreshSignedIn().catch((error: unknown) => {
      ctx.logger.error('llm-pi-ai: could not read the subscription token store')
      ctx.logger.error(error)
    })
    return () => {}
  }, 'llm-pi-ai: adopt signed-in routes')

  installSettingsSection(ctx, NS, Config, config, {
    // Refuse an unserviceable section where it is written: without this a
    // schema-valid profile the adapter cannot serve would be stored and then
    // silently disable every route in this namespace.
    validate: assertServiceable,
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      // Named here rather than left to the settings watcher: `assertServiceable`
      // cannot see the llm registry, so a profile claiming a route another
      // adapter family owns is stored successfully and only fails at this swap.
      // Without its own diagnostic that refusal reaches the operator as a
      // generic "settings: watcher failed", naming neither the route nor why it
      // is not serving. The previous routes keep serving either way.
      try {
        ensureRegistrationFacts()
      } catch (error) {
        ctx.logger.error('llm-pi-ai: keeping the previously registered routes after a refused update')
        ctx.logger.error(error)
      }
      // The directory follows the profiles the registry accepted, so a route
      // that failed to register is not advertised as configurable. A refused
      // directory swap is contained here for the same reason the registry's
      // is: the previous entries keep serving, and `directoryFacts` stays put
      // so returning to a working configuration re-applies.
      try {
        ensureDirectory()
      } catch (error) {
        ctx.logger.error('llm-pi-ai: keeping the previous configurable-provider directory after a refused update')
        ctx.logger.error(error)
      }
    },
  })
}
