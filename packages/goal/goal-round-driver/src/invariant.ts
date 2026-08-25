/** Package-owned goal-round prompt invariants. @module @deepseek-ai/dsh-goal-round-driver/invariant */

import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { foldGoal, type FoldedGoal, type GoalMessageSource, type GoalView } from '@deepseek-ai/dsh-goal'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { renderGoalRoundPrompt } from './prompt.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-goal-round-driver'

/** Cordis companion plugin name. */
export const name = 'goal-round-driver-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Attribute strict goal-fold failures to this companion's reconstruction. */
function foldChecked(events: readonly SessionEvent[], fail: InvariantFailure): FoldedGoal {
  try {
    return foldGoal(events)
  } catch (error: unknown) {
    /* v8 ignore next -- the strict goal decoder throws Error instances */
    const message = error instanceof Error ? error.message : String(error)
    return fail(`cannot reconstruct the goal before a continuation message: ${message}`)
  }
}

/** Recreate the live-shaped view consumed by the package's pure prompt renderer. */
function goalView(folded: FoldedGoal, source: GoalMessageSource, fail: InvariantFailure): GoalView {
  const goal = folded.goal
  if (goal === undefined || folded.createdAt === undefined || folded.updatedAt === undefined
    || goal.phase !== 'active' || goal.id !== source.goalId || goal.revision !== source.revision
    || source.round !== folded.roundsStarted + 1 || source.round > goal.maxGoalRounds) {
    return fail(`goal round ${source.round} cannot be reconstructed from the preceding durable goal state`)
  }
  return {
    ...goal,
    roundsStarted: folded.roundsStarted,
    createdAt: folded.createdAt,
    updatedAt: folded.updatedAt,
    activation: 'armed',
  }
}

/** Whether one retry key claims this package's contributed fallback policy. */
function isGoalRetryPolicy(value: string, fail: InvariantFailure): boolean {
  if (!value.startsWith('["contribution","goal-round-driver",')) return false
  let decoded: unknown
  try {
    decoded = JSON.parse(value)
  } catch (error: unknown) {
    return fail(`goal retry policy key is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(decoded) || decoded.length !== 6
    || decoded[0] !== 'contribution' || decoded[1] !== 'goal-round-driver'
    || decoded[2] !== 'always'
    || decoded.slice(3).some(item => typeof item !== 'number' || !Number.isFinite(item))) {
    return fail('goal retry policy key does not match the contributed always-policy fields')
  }
  return true
}

/** Validate that one contributed retry still belongs to its admitted goal round. */
function validateGoalRetry(
  prior: readonly SessionEvent[],
  event: SessionEvent<'llm/retry'>,
  fail: InvariantFailure,
): void {
  if (!isGoalRetryPolicy(event.data.policyKey, fail)) return
  if (event.data.mode !== 'always') fail('goal retry contribution must use always mode')
  const boundaryIndex = prior.findLastIndex(candidate =>
    candidate.type === 'step/start' || candidate.type === 'step/end')
  const boundary = prior[boundaryIndex]
  if (boundary?.type !== 'step/start') fail('goal retry contribution requires an open step')
  const roundMessage = prior.slice(boundaryIndex + 1).findLast((candidate): candidate is SessionEvent<'user/message'> =>
    candidate.type === 'user/message'
    && candidate.data.source.kind === 'goal'
    && candidate.data.source.round > 0)
  if (roundMessage === undefined || roundMessage.data.source.kind !== 'goal') {
    fail('goal retry contribution requires an admitted goal-round message in the open step')
  }
  const folded = foldChecked(prior, fail)
  const goal = folded.goal
  if (goal === undefined || goal.phase !== 'active'
    || goal.id !== roundMessage.data.source.goalId
    || goal.revision !== roundMessage.data.source.revision
    || folded.roundsStarted !== roundMessage.data.source.round) {
    fail('goal retry contribution does not match the current durable goal round')
  }
}

/** Validate one package-owned continuation message against its durable prefix. */
function validateEvent(
  prior: readonly SessionEvent[],
  event: SessionEvent,
  fail: InvariantFailure,
): void {
  if (event.type === 'llm/retry') {
    validateGoalRetry(prior, event, fail)
    return
  }
  if (event.type !== 'user/message') return
  const source = event.data.source
  if (source.kind !== 'goal' || source.round <= 0) return
  const expected = renderGoalRoundPrompt(goalView(foldChecked(prior, fail), source, fail), source.round)
  if (!isDeepStrictEqual(event.data.content, expected)) {
    fail(`goal round ${source.round} content does not match the package-owned continuation prompt`)
  }
}

/** Check existing sessions and every candidate event before Session publishes it. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    const prior: SessionEvent[] = []
    for (const event of session.events) {
      validateEvent(prior, event, fail)
      prior.push(event)
    }
  }
  /* jscpd:ignore-start -- package companions share dispatch and registration plumbing */
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(session.events, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the goal-round-driver invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
