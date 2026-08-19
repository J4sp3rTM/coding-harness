/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-llm-oauth`.
 * @module @deepseek-ai/dsh-llm-oauth/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-oauth'

/** Cordis companion plugin name. */
export const name = 'llm-oauth-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Install the commit-event lifecycle contract: `llm-oauth/updated` names a
 * committed token-store change, so it can only fire while a sign-in service is
 * live — an emission after disposal means a provider leaked work past its
 * teardown quiescence. The stored values themselves stay pinned by each
 * provider's own suite, because reading one here would put a token in an
 * assertion message.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('llm-oauth/updated', (provider) => {
    if (ctx.get('llmOAuth') === undefined) {
      fail(`llm-oauth/updated for "${provider}" emitted without a live llmOAuth service`)
    }
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
