/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-web-search-duckduckgo`.
 * @module @deepseek-ai/dsh-web-search-duckduckgo/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-web-search-duckduckgo'

/** Cordis companion plugin name. */
export const name = 'web-search-duckduckgo-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: each search is a stateless HTTP scrape and the package
 * owns no event stream or mutable data relation beyond the selection and result
 * caps its `ctx.web` seam enforces on every call.
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
