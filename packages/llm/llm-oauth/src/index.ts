/**
 * Service Definition for the subscription sign-in capability seam
 * (`ctx.llmOAuth`). A provider subscription — Claude Pro/Max, ChatGPT
 * Plus/Pro — authenticates with a rotating OAuth token set rather than an API
 * key, so it cannot travel through the credential-reference seam: there is no
 * stable value to name, the token rotates behind the harness's back, and
 * obtaining one at all needs a browser round trip.
 *
 * Three rules bind every provider of this seam:
 *
 * **Tokens never leave the host.** {@link LlmOAuthService} answers status
 * surfaces with {@link LlmOAuthAccount}, which carries no secret; only an LLM
 * adapter reaches the token store, and only to hand it to the provider SDK
 * that rotates it.
 *
 * **Sign-in is interactive and cancellable.** A flow reports its steps and
 * asks its questions through the caller's {@link LlmOAuthInteraction}, so one
 * implementation serves a terminal, a slash command, and a browser page.
 *
 * **A stored token set owns its route.** While one is stored, the adapter
 * authenticates that route with the subscription and never falls back to an
 * ambient API key — a silent fallback would bill an unrelated account for a
 * request the user meant to put on their subscription.
 *
 * @module @deepseek-ai/dsh-llm-oauth
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {
  LlmOAuthAccount,
  LlmOAuthInteraction,
  LlmOAuthProviderInfo,
} from './types.ts'

export type {
  LlmOAuthAccount,
  LlmOAuthEvent,
  LlmOAuthInteraction,
  LlmOAuthLink,
  LlmOAuthProviderInfo,
  LlmOAuthPrompt,
  LlmOAuthPromptOption,
} from './types.ts'

/**
 * One stored token set. `expires` is epoch milliseconds and already carries
 * the provider's own refresh margin, so a consumer treats `Date.now() >=
 * expires` as "refresh before use" rather than "the token is dead".
 */
export interface LlmOAuthToken {
  /** Bearer token sent with provider requests. */
  access: string
  /** Token exchanged for a fresh {@link access}; empty when the provider issues a non-refreshable grant. */
  refresh: string
  /** Epoch milliseconds after which {@link access} must be refreshed. */
  expires: number
  /**
   * Provider-specific fields the flow returned and the refresh needs back —
   * the ChatGPT flow's account id, for one. Opaque to this seam and stored
   * verbatim.
   */
  extra?: Readonly<Record<string, unknown>>
}

/**
 * Durable token storage, keyed by provider route, one token set per route.
 *
 * `modify` is the only write path, and it is serialized per route across every
 * writer the backing store can see, because the correct writes all depend on
 * the current value: a rotation must not resurrect a token set a sign-out just
 * removed, and two concurrent requests observing the same expired token must
 * produce one refresh rather than two.
 */
export interface LlmOAuthTokenStore {
  /**
   * Read one route's stored token set, expired or not.
   * @param provider - the provider route key.
   * @returns the stored token set, or `undefined` while signed out.
   */
  read(provider: string): Promise<LlmOAuthToken | undefined>
  /**
   * List the routes holding a stored token set, without reading any token.
   * @returns the provider route keys, in no guaranteed order.
   */
  list(): Promise<readonly string[]>
  /**
   * Serialized read-modify-write. `fn` sees the current token set and returns
   * the next one, or `undefined` to leave the entry exactly as it found it.
   * @param provider - the provider route key.
   * @param fn - the transformation to apply while holding the route's lock.
   * @returns the token set stored after the operation.
   */
  modify(
    provider: string,
    fn: (current: LlmOAuthToken | undefined) => Promise<LlmOAuthToken | undefined>,
  ): Promise<LlmOAuthToken | undefined>
  /**
   * Remove one route's token set; removing an absent entry is a no-op.
   * @param provider - the provider route key.
   */
  delete(provider: string): Promise<void>
}

/** Stable error taxonomy for subscription sign-in failures. */
export class LlmOAuthError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'LlmOAuthError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    llmOAuth: LlmOAuthService
  }
}

/**
 * Abstract subscription sign-in service. Providers implement the flows over
 * their own durable store; the store itself is published through
 * {@link LlmOAuthService.tokens} so an LLM adapter can hand it to the SDK that
 * rotates the token, without any other consumer being able to read a secret
 * through the seam's own methods.
 */
export abstract class LlmOAuthService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llmOAuth')
  }

  /**
   * The provider routes this implementation can sign into.
   * @returns the offered routes, in the order sign-in surfaces should present them.
   */
  abstract providers(): readonly LlmOAuthProviderInfo[]

  /**
   * Sign-in state of every offered route.
   * @returns one account per offered route, signed in or not.
   */
  abstract accounts(): Promise<readonly LlmOAuthAccount[]>

  /**
   * Sign-in state of one route.
   * @param provider - the provider route key.
   * @returns the route's account facts.
   * @throws {LlmOAuthError} code `UNKNOWN_PROVIDER` when this implementation does not offer the route.
   */
  abstract status(provider: string): Promise<LlmOAuthAccount>

  /**
   * Run one route's sign-in flow and store the token set it returns. A
   * successful sign-in replaces whatever was stored for the route.
   * @param provider - the provider route key.
   * @param interaction - the surface the flow reports to and asks through.
   * @returns the route's account facts after the token set was stored.
   * @throws {LlmOAuthError} code `UNKNOWN_PROVIDER` when this implementation
   *   does not offer the route, `LOGIN_ABORTED` when the human cancelled, or
   *   `LOGIN_FAILED` when the flow itself failed.
   */
  abstract login(provider: string, interaction: LlmOAuthInteraction): Promise<LlmOAuthAccount>

  /**
   * Remove one route's stored token set. Signing out a route that is already
   * signed out is a no-op; the provider-side session is untouched, because
   * nothing here can end it.
   * @param provider - the provider route key.
   * @throws {LlmOAuthError} code `UNKNOWN_PROVIDER` when this implementation does not offer the route.
   */
  abstract logout(provider: string): Promise<void>

  /**
   * The durable token store, for the LLM adapter that authenticates requests.
   * This is the seam's only path to a secret and exists because the rotation
   * happens inside the provider SDK: the adapter hands the store over and the
   * SDK refreshes under its lock.
   * @returns the store backing this implementation.
   */
  abstract tokens(): LlmOAuthTokenStore

  /* jscpd:ignore-start -- deliberate symmetry with the credential seam's commit
     fan-out: the contained-dispatch shape is the reviewed listener-lifecycle
     contract, and extracting it would couple the two seams' event semantics. */
  /**
   * Fan `llm-oauth/updated` out with contained listener failures: every
   * listener runs, and a sync throw or async rejection is logged without
   * changing the committed operation's outcome — except `INVARIANT`-coded
   * failures, which rethrow after every listener ran (the rethrow reaches the
   * caller only from synchronous listeners, so invariant checks on this event
   * must not be async functions). Providers call this only after the write
   * actually committed, so a broken observer can never make a durable change
   * look failed.
   * @param provider - the provider route whose stored token set changed.
   */
  protected notifyUpdated(provider: string): void {
    let invariantFailure: unknown
    const args = ['llm-oauth/updated', provider]
    for (const listener of this.ctx.events.dispatch('emit', args) as Array<(...listenerArgs: unknown[]) => unknown>) {
      try {
        const returned = listener(provider)
        if (returned != null && typeof (returned as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(returned as PromiseLike<unknown>).then(undefined, (error: unknown) => {
            this.warnListenerFailure(provider, error)
          })
        }
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'INVARIANT') {
          invariantFailure ??= error
          continue
        }
        this.warnListenerFailure(provider, error)
      }
    }
    if (invariantFailure !== undefined) throw invariantFailure as Error
  }
  /* jscpd:ignore-end */

  /** Contained-listener diagnostic shared by the sync and async failure paths. */
  private warnListenerFailure(provider: string, error: unknown): void {
    this.ctx.logger.warn('llm-oauth: an llm-oauth/updated listener for "%s" failed', provider)
    this.ctx.logger.warn(error)
  }
}

export default LlmOAuthService
