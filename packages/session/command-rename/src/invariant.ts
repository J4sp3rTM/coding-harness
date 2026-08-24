/**
 * Package-owned durable invariant companion for `@deepseek-ai/dsh-command-rename`.
 * @module @deepseek-ai/dsh-command-rename/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-command-rename'

/** Cordis companion plugin name. */
export const name = 'command-rename-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the accepted rename is the durable `session/title` event with the `user`
 * source owned by `@deepseek-ai/dsh-session-title`, whose companion already validates that log;
 * this command adapter adds no durable vocabulary of its own.
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
