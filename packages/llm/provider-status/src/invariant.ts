/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-provider-status`.
 * @module @deepseek-ai/dsh-provider-status/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-provider-status'

/** Cordis companion plugin name. */
export const name = 'provider-status-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every stored record is validated field-by-field at
 * its single publish point (recordSnapshot/recordUnavailable), so the only
 * owned relationship — stored values within their documented domains, one
 * latest record per route — is enforced where it is made and pinned by the
 * service suite. The store keeps no durable log and observes no event stream,
 * leaving no runtime relation worth asserting beyond that boundary.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
