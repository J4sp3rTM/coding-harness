/**
 * Local subscription sign-in provider: the durable token document under the
 * harness home, plus the sign-in flows the installed pi-ai catalog ships.
 *
 * One plugin instance owns one document. Which routes it offers is the
 * catalog's answer — every provider declaring an OAuth method — narrowed by
 * configuration when a deployment wants fewer.
 *
 * ```yaml
 * - id: llm-oauth
 *   name: '@deepseek-ai/dsh-llm-oauth-local'
 *   config:
 *     # Offer only these routes; omit the key to offer every catalog route
 *     # that can be signed into.
 *     providers:
 *       - anthropic
 *       - openai-codex
 * ```
 *
 * Signing in stores a token set for the route; the pi-ai LLM adapter then
 * authenticates that route with the subscription instead of an API key, and
 * rotates the token under this store's lock. Nothing here ends the session on
 * the provider's side: signing out removes the local token set, and the
 * account page of the provider is the only place a granted authorization can
 * actually be revoked.
 *
 * @module @deepseek-ai/dsh-llm-oauth-local
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { join, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { LlmOAuthError, LlmOAuthService } from '@deepseek-ai/dsh-llm-oauth'
import type {
  LlmOAuthAccount,
  LlmOAuthInteraction,
  LlmOAuthProviderInfo,
  LlmOAuthTokenStore,
} from '@deepseek-ai/dsh-llm-oauth'
import { oauthFlow, oauthFlows, toPiInteraction, toSeamToken } from './flows.ts'
import type { OAuthFlow } from './flows.ts'
import { FileOAuthTokenStore } from './store.ts'

export { FileOAuthTokenStore, OAUTH_DOCUMENT_VERSION } from './store.ts'

/** Basename of the token document inside the harness home. */
export const OAUTH_FILENAME = '.oauth.json'

/** Plugin config: where the token document lives and which routes are offered. */
export interface Config {
  /** Token document path; defaults to `.oauth.json` under the harness home. */
  path?: string
  /** Harness home used when `path` is omitted; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /**
   * Provider routes this instance offers. Omission offers every installed
   * catalog route that declares an OAuth method. A named route the catalog
   * cannot sign into fails at load rather than being skipped, because the
   * deployment that named it would otherwise see the option quietly missing.
   */
  providers?: string[]
}

/** Fully resolved provider parameters; defaulting happens here, never inline. */
interface ResolvedSpec {
  /** Absolute path of the token document. */
  filename: string
  /** The offered flows, in presentation order. */
  flows: readonly OAuthFlow[]
}

/**
 * Resolve the runtime spec from plugin config: an explicit `path` wins,
 * otherwise the document lives at `<harness home>/.oauth.json`; an explicit
 * `providers` list narrows the catalog's own offer, in the listed order.
 * @param config - raw plugin config.
 * @returns the resolved document location and offered flows.
 * @throws {LlmOAuthError} code `UNKNOWN_PROVIDER` when a configured route cannot be signed into.
 */
export function resolveSpec(config: Config): ResolvedSpec {
  const filename = resolve(config.path ?? join(resolveDshHome(config.dshHome), OAUTH_FILENAME))
  const configured = config.providers
  const flows = configured === undefined || configured.length === 0
    ? [...oauthFlows().values()]
    : configured.map(provider => oauthFlow(provider))
  return { filename, flows }
}

/** Non-secret account facts for one route from its stored token set. */
function toAccount(flow: OAuthFlow, expiresAt: number | undefined): LlmOAuthAccount {
  return {
    provider: flow.provider,
    displayName: flow.displayName,
    loginLabel: flow.loginLabel,
    signedIn: expiresAt !== undefined,
    ...expiresAt === undefined ? {} : { expiresAt },
  }
}

/** `ctx.llmOAuth` over a token document and the installed catalog's flows. */
export class LocalLlmOAuthService extends LlmOAuthService {
  static Config: z<Config> = z.object({
    path: z.string(),
    dshHome: z.string(),
    providers: z.array(z.string()),
  })

  private readonly store: FileOAuthTokenStore
  private readonly flows: ReadonlyMap<string, OAuthFlow>
  private readonly order: readonly LlmOAuthProviderInfo[]

  /**
   * @param ctx - the plugin context this service is published on.
   * @param config - the raw plugin config; defaulting and validation happen here.
   */
  constructor(ctx: Context, public config: Config) {
    super(ctx)
    // Programmatic construction may bypass Schemastery normalization; resolve
    // the same defaults — and refuse the same unserviceable routes — either way.
    const spec = resolveSpec(config)
    this.store = new FileOAuthTokenStore(spec.filename, (provider) => { this.notifyUpdated(provider) })
    this.flows = new Map(spec.flows.map(flow => [flow.provider, flow]))
    this.order = spec.flows.map(({ provider, displayName, loginLabel }) => ({ provider, displayName, loginLabel }))
  }

  /**
   * The provider routes this instance offers.
   * @returns the offered routes, in configuration order.
   */
  providers(): readonly LlmOAuthProviderInfo[] {
    return this.order
  }

  /**
   * The offered route under one key.
   * @param provider - the provider route key.
   * @returns the route's flow.
   * @throws {LlmOAuthError} code `UNKNOWN_PROVIDER` when this instance does not offer the route.
   */
  private flowOf(provider: string): OAuthFlow {
    const flow = this.flows.get(provider)
    if (flow === undefined) {
      const offered = [...this.flows.keys()].join(', ')
      throw new LlmOAuthError(
        `llm-oauth-local: provider "${provider}" is not offered for subscription sign-in;`
        + ` this deployment offers ${offered.length === 0 ? 'none' : offered}`,
        'UNKNOWN_PROVIDER',
      )
    }
    return flow
  }

  /**
   * Sign-in state of every offered route.
   * @returns one account per offered route.
   */
  async accounts(): Promise<readonly LlmOAuthAccount[]> {
    const signedIn = new Set(await this.store.list())
    return Promise.all(this.order.map(async ({ provider }) => {
      const flow = this.flowOf(provider)
      if (!signedIn.has(provider)) return toAccount(flow, undefined)
      return toAccount(flow, (await this.store.read(provider))?.expires)
    }))
  }

  /**
   * Sign-in state of one route.
   * @param provider - the provider route key.
   * @returns the route's account facts.
   */
  async status(provider: string): Promise<LlmOAuthAccount> {
    const flow = this.flowOf(provider)
    return toAccount(flow, (await this.store.read(provider))?.expires)
  }

  /**
   * Run one route's sign-in flow and store the token set it returns.
   * @param provider - the provider route key.
   * @param interaction - the surface the flow reports to and asks through.
   * @returns the route's account facts after the token set was stored.
   */
  async login(provider: string, interaction: LlmOAuthInteraction): Promise<LlmOAuthAccount> {
    const flow = this.flowOf(provider)
    const piInteraction = toPiInteraction(interaction, (error) => {
      this.ctx.logger.warn('llm-oauth-local: a sign-in surface failed to render an event for "%s"', provider)
      this.ctx.logger.warn(error)
    })
    let credential
    try {
      credential = await flow.auth.login(piInteraction)
    } catch (error) {
      if (interaction.signal?.aborted === true) {
        throw new LlmOAuthError(`llm-oauth-local: sign-in to "${provider}" was cancelled`, 'LOGIN_ABORTED', { cause: error })
      }
      throw new LlmOAuthError(`llm-oauth-local: sign-in to "${provider}" failed`, 'LOGIN_FAILED', { cause: error })
    }
    const token = toSeamToken(credential)
    // A completed sign-in replaces whatever was stored, including a token set
    // a concurrent refresh just wrote: the flow's tokens are the newer grant.
    const stored = await this.store.modify(provider, () => Promise.resolve(token))
    return toAccount(flow, stored?.expires)
  }

  /**
   * Remove one route's stored token set.
   * @param provider - the provider route key.
   */
  async logout(provider: string): Promise<void> {
    this.flowOf(provider)
    await this.store.delete(provider)
  }

  /**
   * The durable token store, for the LLM adapter that authenticates requests.
   * @returns the store backing this service.
   */
  tokens(): LlmOAuthTokenStore {
    return this.store
  }
}

export default LocalLlmOAuthService
