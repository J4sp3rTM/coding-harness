/** Package-owned invariant companion for the development workflow consumer. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-development-workflow'
export const name = 'tool-development-workflow-invariant'
export const inject = ['invariants']

/** No runtime invariant: the workflow engine owns every run lifecycle and this consumer adds no durable stream. */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
