/**
 * Provider and contributed model-request retry policies on the agent loop's
 * recovery extension point. Each scheduled retry is durable before its cancellable wait.
 *
 * @module @deepseek-ai/dsh-llm-retry
 */

import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context, Events } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import type { LlmFailure, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { RetryId } from './brand.ts'
import type { LlmRetryEventData } from './types.ts'

export type { LlmRetryEventData, LlmRetryStartedEventData } from './types.ts'
export { RetryId } from './brand.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    llmRetry: LlmRetry
  }
}

/** This policy executor has no config; providers own `retryPolicy`. */
export type Config = Readonly<Record<string, never>>

/** Runtime schema for {@link Config}. */
export const Config = z.object({}) as unknown as z<Config>

function validateConfig(config: Config): void {
  const [key] = Object.keys(config)
  if (key === undefined) return
  if (key === 'retryPolicy') {
    throw new Error('llm-retry: retryPolicy belongs under each provider configuration')
  }
  throw new Error(`llm-retry: unknown key "${key}"`)
}

/** Non-serializable hooks used to make timing policy deterministic in tests. */
export interface RetryInternals {
  /** Random sample in the inclusive zero-to-one range used for jitter. */
  random?: () => number
}

/** Facts available to one process-local request-retry contribution. */
export type RequestRetryContext = Parameters<Events['agent/request-error']>[0]

/** One eligible fallback policy and/or cancellation signal for a failed request. */
export interface RequestRetryContribution {
  /** Policy considered only after the provider policy and downstream recovery decline. */
  readonly policy?: ResolvedRetryPolicy
  /** Additional cancellation signal applied to provider-owned and fallback waits. */
  readonly signal?: AbortSignal
}

/** Process-local contribution to request recovery owned by another capability. */
export interface RequestRetryContributor {
  /** Stable policy identity used in durable retry-chain keys. */
  readonly id: string
  /**
   * Resolve eligibility and lifecycle cancellation for one failed request.
   * @param request - normalized failure and exact serving-provider facts.
   * @returns contribution for this request, or undefined when ineligible.
   */
  resolve(request: RequestRetryContext): RequestRetryContribution | undefined
}

type DownstreamOutcome =
  | { readonly type: 'decision'; readonly decision: RequestErrorAction }
  | { readonly type: 'error'; readonly error: unknown }

async function settleDownstream(
  next: () => Promise<RequestErrorAction>,
): Promise<DownstreamOutcome> {
  try {
    return { type: 'decision', decision: await next() }
  } catch (error: unknown) {
    return { type: 'error', error }
  }
}

function localDelay(config: ResolvedRetryPolicy, retry: number, random: () => number): number {
  const exponent = Math.min(retry - 1, 1024)
  const exponential = Math.min(config.initialDelayMs * 2 ** exponent, config.maxDelayMs)
  const jitter = 1 - config.jitterRatio + 2 * config.jitterRatio * random()
  return Math.min(exponential * jitter, config.maxDelayMs)
}

function retryPolicyKey(policy: ResolvedRetryPolicy): string {
  return policy.mode === 'always'
    ? JSON.stringify([policy.mode, policy.initialDelayMs, policy.maxDelayMs, policy.jitterRatio])
    : JSON.stringify([
      policy.mode,
      policy.maxRetries,
      [...policy.retryableCodes].sort(),
      policy.initialDelayMs,
      policy.maxDelayMs,
      policy.jitterRatio,
    ])
}

function contributionPolicyKey(id: string, policy: ResolvedRetryPolicy): string {
  return policy.mode === 'always'
    ? JSON.stringify(['contribution', id, policy.mode, policy.initialDelayMs, policy.maxDelayMs, policy.jitterRatio])
    : JSON.stringify([
      'contribution',
      id,
      policy.mode,
      policy.maxRetries,
      [...policy.retryableCodes].sort(),
      policy.initialDelayMs,
      policy.maxDelayMs,
      policy.jitterRatio,
    ])
}

function cancellableDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    function onAbort(): void {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

type BackoffOutcome =
  | { readonly handled: false }
  | { readonly handled: true; readonly action: RequestErrorAction }

interface ResolvedContributions {
  readonly signals: AbortSignal[]
  readonly fallbacks: { readonly id: string; readonly policy: ResolvedRetryPolicy }[]
}

/**
 * `ctx.llmRetry`: the single executor for provider policies and contributed
 * fallback policies. Contributions supply policy and lifecycle facts; this
 * service alone owns backoff, durable retry events, chain numbering, and drain.
 */
export class LlmRetry extends Service {
  static inject = ['agents']
  private readonly random: () => number
  private readonly lifetime = new AbortController()
  private readonly active = new Set<Promise<RequestErrorAction>>()
  private readonly contributors = new Map<string, RequestRetryContributor>()

  /**
   * Create the retry executor and install its request-error listener.
   * @param ctx - plugin context that owns the service and active waits.
   * @param config - empty executor config; provider registrations own policy.
   * @param internals - non-serializable deterministic hooks for tests.
   */
  constructor(ctx: Context, config: Config = {}, internals: RetryInternals = {}) {
    super(ctx, 'llmRetry')
    validateConfig(config)
    this.random = internals.random ?? Math.random

    const disposeListener = ctx.on('agent/request-error', (
      payload,
      next: () => Promise<RequestErrorAction>,
    ) => {
      // A waterfall may have captured this callback before its registration was
      // removed. Lifetime cancellation must prevent that stale callback from
      // entering a downstream policy after disposal.
      if (this.lifetime.signal.aborted) return Promise.resolve<RequestErrorAction>(undefined)
      return this.track(this.recover(payload, next))
    })

    ctx.effect(() => async () => {
      disposeListener()
      this.lifetime.abort(new Error('llm-retry plugin disposed'))
      await Promise.allSettled([...this.active])
    }, 'llm-retry: abort and drain active recovery')
  }

  /**
   * Register one fallback/cancellation contribution under a stable identity.
   * @param contributor - resolver for another capability's request failures.
   * @returns disposer that removes the contribution with its owning fiber.
   */
  register(contributor: RequestRetryContributor): () => void {
    if (contributor.id.length === 0) throw new Error('llm-retry: contributor id must be non-empty')
    if (this.contributors.has(contributor.id)) {
      throw new Error(`llm-retry: contributor ${JSON.stringify(contributor.id)} is already registered`)
    }
    const dispose = this.ctx.effect(function* (this: LlmRetry) {
      this.contributors.set(contributor.id, contributor)
      yield () => { this.contributors.delete(contributor.id) }
    }.bind(this), `llmRetry.register(${JSON.stringify(contributor.id)})`)
    return () => void dispose()
  }

  private track(operation: Promise<RequestErrorAction>): Promise<RequestErrorAction> {
    const tracked = operation.finally(() => this.active.delete(tracked))
    this.active.add(tracked)
    return tracked
  }

  private async backoff(
    agent: Agent,
    turn: number,
    step: number,
    failure: LlmFailure,
    provider: string,
    policy: ResolvedRetryPolicy,
    policyKey: string,
    retry: number,
    retryId: RetryId,
    delayMs: number,
    signals: readonly AbortSignal[],
  ): Promise<RequestErrorAction> {
    const fusedSignal = AbortSignal.any([...signals, this.lifetime.signal])
    if (fusedSignal.aborted) return
    const eventData: LlmRetryEventData = policy.mode === 'normal'
      ? {
        retryId,
        turn,
        step,
        provider,
        mode: policy.mode,
        policyKey,
        retry,
        maxRetries: policy.maxRetries,
        delayMs,
        failure,
      }
      : {
        retryId,
        turn,
        step,
        provider,
        mode: policy.mode,
        policyKey,
        retry,
        delayMs,
        failure,
      }
    agent.session.append('llm/retry', eventData)
    if (!await cancellableDelay(delayMs, fusedSignal)) return
    agent.session.append('llm/retry-started', { retryId, turn, step, retry })
    return { kind: 'retry' }
  }

  private resolveContributions(request: RequestRetryContext): ResolvedContributions {
    const signals: AbortSignal[] = []
    const fallbacks: ResolvedContributions['fallbacks'][number][] = []
    for (const contributor of [...this.contributors.values()]) {
      const contribution = contributor.resolve(request)
      if (contribution?.signal !== undefined) signals.push(contribution.signal)
      if (contribution?.policy !== undefined) {
        fallbacks.push({ id: contributor.id, policy: contribution.policy })
      }
    }
    return { signals, fallbacks }
  }

  private fallbackOf(
    fallbacks: ResolvedContributions['fallbacks'],
  ): ResolvedContributions['fallbacks'][number] | undefined {
    if (fallbacks.length > 1) {
      throw new Error(`llm-retry: multiple fallback policies are eligible (${fallbacks.map(item => item.id).join(', ')})`)
    }
    return fallbacks[0]
  }

  private async schedule(
    { agent, turn, step, provider, failure }: RequestRetryContext,
    policy: ResolvedRetryPolicy,
    policyKey: string,
    signals: readonly AbortSignal[],
  ): Promise<BackoffOutcome> {
    if (policy.mode === 'normal' && !policy.retryableCodes.includes(failure.code)) {
      return { handled: false }
    }
    const priorPolicyRetry = agent.session.events.findLast((event): event is SessionEvent<'llm/retry'> =>
      event.type === 'llm/retry'
      && event.data.turn === turn
      && event.data.step === step
      && event.data.provider === provider
      && event.data.policyKey === policyKey,
    )
    const previousRetry = priorPolicyRetry?.data.retry ?? 0
    if (policy.mode === 'normal' && previousRetry >= policy.maxRetries) return { handled: false }
    const retry = previousRetry + 1
    const retryId = priorPolicyRetry?.data.retryId ?? RetryId(randomUUID())
    let delayMs: number
    if (failure.providerRetryAfterMs !== undefined
      && Number.isFinite(failure.providerRetryAfterMs)
      && failure.providerRetryAfterMs > 0) {
      if (failure.providerRetryAfterMs > policy.maxDelayMs) {
        if (policy.mode === 'normal') return { handled: false }
        delayMs = localDelay(policy, retry, this.random)
      } else {
        delayMs = failure.providerRetryAfterMs
      }
    } else {
      delayMs = localDelay(policy, retry, this.random)
    }
    const action = await this.backoff(
      agent, turn, step, failure, provider, policy, policyKey, retry, retryId, delayMs, signals,
    )
    return { handled: true, action }
  }

  private async recover(
    request: RequestRetryContext,
    next: () => Promise<RequestErrorAction>,
  ): Promise<RequestErrorAction> {
    const { provider, retryPolicy: policy, signal } = request
    const contributions = this.resolveContributions(request)
    const signals = [signal, ...contributions.signals]
    if (policy?.mode === 'always') {
      if (signals.some(item => item.aborted) || this.lifetime.signal.aborted) return
      const fusedSignal = AbortSignal.any([...signals, this.lifetime.signal])
      // The loop and plugin lifetime stay open until delegated recovery settles.
      // An abort then wins before the decision or fallback can mutate later state.
      const downstream = await settleDownstream(next)
      if (fusedSignal.aborted) return
      if (downstream.type === 'error') {
        this.ctx.logger.warn(
          `llm-retry: provider "${provider}" always policy ignored a downstream recovery failure: %o`,
          downstream.error,
        )
      }
      if (downstream.type === 'decision' && downstream.decision?.kind === 'retry') {
        return downstream.decision
      }
      const scheduled = await this.schedule(request, policy, retryPolicyKey(policy), signals)
      return scheduled.handled ? scheduled.action : undefined
    }
    if (policy !== undefined) {
      const scheduled = await this.schedule(request, policy, retryPolicyKey(policy), signals)
      if (scheduled.handled) return scheduled.action
    }

    const downstream = await next()
    if (downstream?.kind === 'retry' || signals.some(item => item.aborted)) return downstream
    const fallback = this.fallbackOf(contributions.fallbacks)
    if (fallback === undefined) return downstream
    const scheduled = await this.schedule(
      request,
      fallback.policy,
      contributionPolicyKey(fallback.id, fallback.policy),
      signals,
    )
    return scheduled.handled ? scheduled.action : downstream
  }
}

export default LlmRetry
