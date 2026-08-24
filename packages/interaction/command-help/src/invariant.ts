/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-command-help`.
 * @module @deepseek-ai/dsh-command-help/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-command-help'

/** Cordis companion plugin name. */
export const name = 'command-help-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: /help owns no durable events — it renders the command
 * registry's live view, and command lifecycle pairing (the only durable
 * relation a help invocation touches) is already validated by the
 * `@deepseek-ai/dsh-commands` companion.
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
