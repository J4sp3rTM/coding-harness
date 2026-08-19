/**
 * Package-owned durable invariant companion for `@deepseek-ai/dsh-command-rat`.
 * @module @deepseek-ai/dsh-command-rat/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { RAT_PROMPT_EVENT } from './constants.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-command-rat'

/** Cordis companion plugin name. */
export const name = 'command-rat-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate one durable last-wins custom-prompt event. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== RAT_PROMPT_EVENT) return
  const value: unknown = event.data.text
  if (value === null) return
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    fail('rat/prompt text must be a non-empty, trimmed string or null')
  }
}

/** Install validation for loaded and newly appended custom-prompt state. */
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
