/**
 * Human-facing `/usage` command: report provider token consumption, context
 * pressure, and — when the composition publishes them — provider quota and
 * account balance for the receiving session's active route.
 *
 * `/usage` is read-only. It measures the receiving session's durable log
 * through the token-meter service and renders one fixed reply; it appends
 * nothing to the session and tolerates any arguments after the command name.
 * The provider-status and deepseek-account services are optional reads via
 * `ctx.get`, so compositions without them report the session's own figures
 * alone.
 *
 * @module @deepseek-ai/dsh-command-usage
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { DeepSeekAccountBalance } from '@deepseek-ai/dsh-llm-deepseek'
// Type-only: resolves the optional provider-status Context declaration.
import type {
  ProviderQuotaDimension,
  ProviderStatusRecord,
} from '@deepseek-ai/dsh-provider-status'
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter'

export const name = 'command-usage'
export const inject = ['commands', 'tokenMeter']

/** Presentation order for quota dimensions; a dimension absent from the snapshot is skipped. */
const QUOTA_RENDER_ORDER: readonly ProviderQuotaDimension[] = [
  'tokens',
  'requests',
  'inputTokens',
  'outputTokens',
]

/** Human labels for each dimension, in {@link QUOTA_RENDER_ORDER} terms. */
const QUOTA_LABELS: Readonly<Record<ProviderQuotaDimension, string>> = {
  tokens: 'tokens',
  requests: 'requests',
  inputTokens: 'input tokens',
  outputTokens: 'output tokens',
}

/**
 * Extra render inputs resolved from the receiving composition. Every field
 * is optional and its absence simply omits the corresponding line.
 */
export interface UsageReportContext {
  /** Latest provider-status record for the receiving agent's active route. */
  status?: ProviderStatusRecord
  /** Remaining account balance in USD when the route's provider exposes one. */
  balanceUsd?: number
  /** Clock for the reset countdown; defaults to the current time. */
  now?: number
}

/** Fail closed when a future baseline kind reaches the rendering switch. */
/* v8 ignore next 3 -- only the ignored default arm calls this; the closed union cannot reach it through the public API. */
function assertNever(value: never): never {
  throw new Error(`command-usage: unsupported measurement baseline ${JSON.stringify(value)}`)
}

/** Whole-percent remaining, clamped so a misbehaving figure cannot read past either end. */
function remainingPercent(dimension: { limit: number; remaining: number }): number {
  return Math.min(100, Math.max(0, Math.round(dimension.remaining / dimension.limit * 100)))
}

/** Render one non-negative millisecond count as its two most significant units (`5m`, `1h 30m`). */
function humanizeDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000)
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 && parts.length < 2) parts.push(`${minutes}m`)
  if (seconds > 0 && parts.length < 2) parts.push(`${seconds}s`)
  return parts.length === 0 ? '0s' : parts.join(' ')
}

/**
 * The earliest reset still ahead of `now` among a set of observations, as a
 * countdown segment. A window whose reset already passed contributes nothing.
 * @param resets - every reset the observation carried, in epoch milliseconds.
 * @param now - epoch milliseconds the countdown is measured against.
 * @returns the `resets in …` segment, or undefined when none lies ahead.
 */
function resetSegment(resets: readonly (number | undefined)[], now: number): string | undefined {
  const next = resets
    .filter((reset): reset is number => reset !== undefined && reset > now)
    .sort((left, right) => left - right)
    .at(0)
  return next === undefined ? undefined : `resets in ${humanizeDuration(next - now)}`
}

/**
 * Render the rate-limit counter segment: whole-percent remaining per reported
 * dimension plus a countdown when the provider documents a future reset. An
 * unavailable record and a record carrying only plan windows both render
 * nothing rather than an empty claim.
 * @param record - the latest provider-status record for the active route.
 * @param now - epoch milliseconds the countdown is measured against.
 * @returns the segment, or undefined when no counter dimension was observed.
 */
export function renderQuotaSegment(record: ProviderStatusRecord, now: number): string | undefined {
  if (record.kind !== 'snapshot' || record.dimensions.length === 0) return undefined
  const byDimension = new Map(record.dimensions.map(dimension => [dimension.dimension, dimension]))
  const parts: string[] = []
  for (const dimension of QUOTA_RENDER_ORDER) {
    const snapshotDimension = byDimension.get(dimension)
    if (snapshotDimension === undefined) continue
    parts.push(`${remainingPercent(snapshotDimension)}% ${QUOTA_LABELS[dimension]} left`)
  }
  const reset = resetSegment(record.dimensions.map(dimension => dimension.reset), now)
  return `quota ${[...parts, ...reset === undefined ? [] : [reset]].join(' · ')}`
}

/**
 * Render the subscription allowance segment: whole-percent remaining per plan
 * window in the provider's own window order, plus the earliest future reset.
 * @param record - the latest provider-status record for the active route.
 * @param now - epoch milliseconds the countdown is measured against.
 * @returns the segment, or undefined when no plan window was observed.
 */
export function renderPlanSegment(record: ProviderStatusRecord, now: number): string | undefined {
  if (record.kind !== 'snapshot' || record.windows.length === 0) return undefined
  const parts = record.windows.map((window) => {
    const remaining = Math.min(100, Math.max(0, Math.round(100 - window.usedPercent)))
    return `${remaining}% left (${window.window})`
  })
  const reset = resetSegment(record.windows.map(window => window.reset), now)
  return `plan ${[...parts, ...reset === undefined ? [] : [reset]].join(' · ')}`
}

/**
 * Render the `/usage` reply as one line. Provider allowance leads — plan
 * windows before rate-limit counters — and the session's own figures trail
 * after an em dash: the latest call's disjoint input and output counts (or
 * why no provider usage exists), current request pressure, and account
 * balance. Nothing here invents values: an unobserved allowance or an unknown
 * balance contributes no segment at all, leaving the trailing figures alone.
 *
 * @param measurement - detached measurement from one token-meter `measure` call.
 * @param context - optional quota/balance facts resolved by the caller.
 * @returns the human-facing text; never throws for an ordinary measurement.
 */
export function renderUsage(measurement: TokenMeasurement, context: UsageReportContext = {}): string {
  const { baseline, totalTokens } = measurement
  let call: string
  switch (baseline.kind) {
    case 'usage':
      call = `${baseline.usage.inputTokens} in / ${baseline.usage.outputTokens} out · ${totalTokens} ctx`
      break
    case 'estimated':
      call = `no provider call yet (estimated) · ${totalTokens} ctx`
      break
    case 'none':
      // A 'none' baseline prices neither a call nor a surface, so the meter
      // fixes the pressure at zero; the constant keeps that definition local.
      call = 'no provider call yet · 0 ctx'
      break
    /* v8 ignore next 2 -- TokenMeasurementBaseline is closed; a future kind must be given a segment here. */
    default:
      return assertNever(baseline)
  }
  const now = context.now ?? Date.now()
  const allowance = context.status === undefined
    ? []
    : [renderPlanSegment(context.status, now), renderQuotaSegment(context.status, now)]
      .filter((segment): segment is string => segment !== undefined)
  const detail = [call, ...context.balanceUsd === undefined ? [] : [`$${context.balanceUsd.toFixed(2)} left`]]
  return [...allowance.length === 0 ? [] : [allowance.join(' · ')], detail.join(' · ')].join(' — ')
}

/**
 * Execute one `/usage` invocation against its receiving session.
 * @param ctx - context carrying the token meter and the optional status services.
 * @param invocation - the dispatching command invocation; `rawInput` is ignored.
 * @returns the rendered usage report.
 */
async function executeUsage(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const measurement = ctx.tokenMeter.measure(invocation.agent.session)
  const report: UsageReportContext = {}
  // The route this session talks to is the one its latest logged request used,
  // not the Agent's creation-time option: an Agent created on the deployment
  // default and then switched in a composer keeps those options, so reading
  // them would report another provider's quota. A session that has issued no
  // request yet has no route to report.
  const provider = invocation.agent.session.requestHeader()?.config.provider
  if (provider !== undefined) {
    // Both services are optional: an unmounted store or an unserved balance
    // leaves the report at the session's own figures instead of failing.
    const status = ctx.get('providerStatus')?.lookup(provider)
    const account: DeepSeekAccountBalance | undefined = ctx.get('deepseekAccount')
    const balanceUsd = await account?.remainingUsd(provider, invocation.signal)
    if (status !== undefined) report.status = status
    if (balanceUsd !== undefined) report.balanceUsd = balanceUsd
  }
  return {
    kind: 'success',
    text: renderUsage(measurement, report),
  }
}

/**
 * Register `/usage` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the token meter.
 */
export function apply(ctx: Context): void {
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => executeUsage(ctx, invocation)
  ctx.effect(() => ctx.commands.register({
    name: 'usage',
    description: 'Show provider token usage',
    handler,
  }), 'command-usage lifecycle')
}
