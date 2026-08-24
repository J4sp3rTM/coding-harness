/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-electron-carrier`.
 * @module @deepseek-ai/dsh-host-electron-carrier/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-electron-carrier'

/** Cordis companion plugin name. */
export const name = 'host-electron-carrier-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this carrier answers protocol.handle requests from
 * the in-process route table on the same service instance; there is no
 * independent event stream to compare, and upgrade registrations are
 * recorded for composition parity but never dispatched.
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
