/**
 * The sign-in flows this provider serves, and the translation between the
 * seam's interaction vocabulary and pi-ai's.
 *
 * The flows themselves are not implemented here. Every OAuth-capable provider
 * in the installed pi-ai catalog already carries one — the authorization
 * endpoint, the PKCE exchange, the loopback callback server, and the refresh
 * grant — and the same catalog owns the request path that turns a stored token
 * into the provider's expected identity headers. Reimplementing the flow beside
 * that would leave two descriptions of one protocol, and only one of them would
 * be the one requests actually take.
 *
 * @module dsh-llm-oauth-local/flows
 */

import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import type { AuthEvent, AuthPrompt, OAuthAuth, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai'
import { LlmOAuthError } from '@deepseek-ai/dsh-llm-oauth'
import type { LlmOAuthEvent, LlmOAuthInteraction, LlmOAuthPrompt, LlmOAuthToken } from '@deepseek-ai/dsh-llm-oauth'

/** One catalog route that can be signed into, with the flow behind it. */
export interface OAuthFlow {
  /** Provider route key; also the LLM adapter's route key and the settings address. */
  provider: string
  /** Name shown by sign-in surfaces. */
  displayName: string
  /** Label for the sign-in action. */
  loginLabel: string
  /** The catalog flow this route signs in through. */
  auth: OAuthAuth
}

let index: Map<string, OAuthFlow> | undefined

/**
 * Every installed catalog route that declares an OAuth method, indexed by
 * route key and built once. Construction is the catalog's own, so a pi-ai
 * upgrade that adds a subscription provider offers it here without an edit.
 * @returns the offered flows by provider route key.
 */
export function oauthFlows(): ReadonlyMap<string, OAuthFlow> {
  index ??= new Map(builtinProviders().flatMap((provider) => {
    const auth = provider.auth.oauth
    if (auth === undefined) return []
    return [[provider.id, {
      provider: provider.id,
      displayName: provider.name,
      // The flow's own name describes the subscription being signed into
      // ("Anthropic (Claude Pro/Max)"), which is what a chooser must show;
      // the provider name only says which endpoint it is.
      loginLabel: auth.loginLabel ?? auth.name,
      auth,
    }] as const]
  }))
  return index
}

/**
 * The flow for one route.
 * @param provider - the provider route key.
 * @returns the route's flow.
 * @throws {LlmOAuthError} code `UNKNOWN_PROVIDER` when no installed catalog route offers OAuth under that key.
 */
export function oauthFlow(provider: string): OAuthFlow {
  const flow = oauthFlows().get(provider)
  if (flow === undefined) {
    const offered = [...oauthFlows().keys()].join(', ')
    throw new LlmOAuthError(
      `llm-oauth-local: no subscription sign-in for provider "${provider}"; this build offers ${offered}`,
      'UNKNOWN_PROVIDER',
    )
  }
  return flow
}

/**
 * Translate one pi-ai flow event into the seam's vocabulary.
 * @param event - the event the flow reported.
 * @returns the seam event to hand the surface.
 */
function toSeamEvent(event: AuthEvent): LlmOAuthEvent {
  switch (event.type) {
    case 'auth_url':
      return { kind: 'auth-url', url: event.url, ...event.instructions === undefined ? {} : { instructions: event.instructions } }
    case 'device_code':
      return {
        kind: 'device-code',
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds },
        ...event.expiresInSeconds === undefined ? {} : { expiresInSeconds: event.expiresInSeconds },
      }
    case 'progress':
      return { kind: 'progress', message: event.message }
    case 'info':
      return { kind: 'info', message: event.message, ...event.links === undefined ? {} : { links: event.links } }
    /* v8 ignore next 4 -- merge-extensible upstream union: an added member renders as plain progress. */
    default: {
      const { type } = event as { type: string }
      return { kind: 'progress', message: type }
    }
  }
}

/**
 * Translate one pi-ai prompt into the seam's vocabulary.
 * @param prompt - the question the flow asked.
 * @returns the seam prompt to put to the surface.
 */
function toSeamPrompt(prompt: AuthPrompt): LlmOAuthPrompt {
  const signal = prompt.signal === undefined ? {} : { signal: prompt.signal }
  switch (prompt.type) {
    case 'select':
      return { ...signal, kind: 'select', message: prompt.message, options: prompt.options }
    case 'manual_code':
      return { ...signal, kind: 'manual-code', message: prompt.message, ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder } }
    case 'secret':
      return { ...signal, kind: 'secret', message: prompt.message, ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder } }
    case 'text':
      return { ...signal, kind: 'text', message: prompt.message, ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder } }
    /* v8 ignore next 4 -- merge-extensible upstream union: an added member is asked as free text. */
    default: {
      const { message } = prompt as { message: string }
      return { ...signal, kind: 'text', message }
    }
  }
}

/**
 * Present a seam interaction to a pi-ai flow. A `notify` that throws is
 * contained: a surface failing to render a progress line must not fail a
 * sign-in that is otherwise proceeding, and the flow has no way to report the
 * difference.
 * @param interaction - the seam surface the flow talks to.
 * @param onNotifyFailure - observes a contained `notify` failure.
 * @returns the normalized pi-ai interaction to pass into the provider flow.
 */
export function toPiInteraction(
  interaction: LlmOAuthInteraction,
  onNotifyFailure: (error: unknown) => void,
): ProviderAuthInteraction {
  return {
    signal: interaction.signal ?? new AbortController().signal,
    prompt: prompt => interaction.prompt(toSeamPrompt(prompt)),
    notify: (event) => {
      try {
        interaction.notify(toSeamEvent(event))
      } catch (error) {
        onNotifyFailure(error)
      }
    },
  }
}

/**
 * Read a pi-ai OAuth credential as a seam token set, keeping the fields only
 * the provider understands.
 * @param credential - the credential a flow or refresh returned.
 * @returns the token set to store.
 */
export function toSeamToken(credential: OAuthCredential): LlmOAuthToken {
  const { type: _type, access, refresh, expires, ...extra } = credential
  return { access, refresh, expires, ...Object.keys(extra).length === 0 ? {} : { extra } }
}

/**
 * Render a stored token set as the pi-ai credential its flows expect.
 * @param token - the stored token set.
 * @returns the pi-ai OAuth credential.
 */
export function toPiCredential(token: LlmOAuthToken): OAuthCredential {
  return { ...token.extra, type: 'oauth', access: token.access, refresh: token.refresh, expires: token.expires }
}
