/**
 * Package-owned durable invariant companion for `@deepseek-ai/dsh-command-clear`.
 * @module @deepseek-ai/dsh-command-clear/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { CLEAR_CHECKPOINT, CLEAR_PLUGIN_NAME } from './constants.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-command-clear'

/** Cordis companion plugin name. */
export const name = 'command-clear-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate one model-visible clear checkpoint against its package-owned source. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'user/message') return
  const source = event.data.source
  if (source.kind !== 'plugin' || source.plugin !== CLEAR_PLUGIN_NAME) return
  const block = event.data.content.length === 1 ? event.data.content[0] : undefined
  if (block?.type !== 'text' || block.text !== CLEAR_CHECKPOINT) {
    fail('clear replacement messages must contain the fixed fresh-start checkpoint')
  }
}

/** Install validation for loaded and newly appended clear checkpoints. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const seed = (session: Session): void => {
    for (const event of session.events) validateEvent(event, fail)
  }
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [Session, SessionEvent]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
