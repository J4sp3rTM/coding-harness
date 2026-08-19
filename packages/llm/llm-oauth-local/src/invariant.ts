/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-llm-oauth-local`.
 * @module @deepseek-ai/dsh-llm-oauth-local/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-oauth-local'

/** Cordis companion plugin name. */
export const name = 'llm-oauth-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Install the commit-event ownership contract: this provider emits
 * `llm-oauth/updated` only for a route it actually offers, so an emission
 * naming an unoffered route means a store commit escaped the offered set —
 * the one relation an observer can check without reading a token.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('llm-oauth/updated', (provider) => {
    const service = ctx.get('llmOAuth')
    if (service === undefined) return
    if (service.providers().some(offered => offered.provider === provider)) return
    fail(`llm-oauth/updated named "${provider}", which the live llmOAuth service does not offer`)
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
