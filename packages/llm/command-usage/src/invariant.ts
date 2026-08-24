/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-command-usage`.
 * @module @deepseek-ai/dsh-command-usage/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-command-usage'

/** Cordis companion plugin name. */
export const name = 'command-usage-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: `/usage` appends nothing to any session log — it reads
 * one measurement and returns text, so it owns no durable relationship worth
 * asserting. Measurement consistency is the token meter's own contract with
 * the session log, and the command/run–command/done lifecycle pairing around
 * each invocation is already validated by the commands package's companion.
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
