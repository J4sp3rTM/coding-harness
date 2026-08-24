/**
 * Human-facing `/usage` command: report provider token consumption and
 * context pressure for the receiving session.
 *
 * `/usage` is read-only. It measures the receiving session's durable log
 * through the token-meter service and renders one fixed two-line reply; it
 * appends nothing to the session and tolerates any arguments after the
 * command name.
 *
 * @module @deepseek-ai/dsh-command-usage
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter'

export const name = 'command-usage'
export const inject = ['commands', 'tokenMeter']

/** Fail closed when a future baseline kind reaches the rendering switch. */
/* v8 ignore next 3 -- only the ignored default arm calls this; the closed union cannot reach it through the public API. */
function assertNever(value: never): never {
  throw new Error(`command-usage: unsupported measurement baseline ${JSON.stringify(value)}`)
}

/**
 * Render one measurement as the fixed two-line `/usage` reply: the first line
 * names the latest provider call — its disjoint input and output counts, or
 * why no provider usage exists — and the second states current request
 * pressure.
 *
 * @param measurement - detached measurement from one token-meter `measure` call.
 * @returns the human-facing text; never throws for an ordinary measurement.
 */
export function renderUsage(measurement: TokenMeasurement): string {
  const { baseline, totalTokens } = measurement
  switch (baseline.kind) {
    case 'usage':
      return `Latest provider call: ${baseline.usage.inputTokens} input / ${baseline.usage.outputTokens} output tokens.`
        + `\nCurrent context pressure: ${totalTokens} tokens.`
    case 'estimated':
      return 'No provider usage recorded yet — the latest call was priced heuristically.'
        + `\nCurrent context pressure: ${totalTokens} tokens.`
    case 'none':
      // A 'none' baseline prices neither a call nor a surface, so the meter
      // fixes the pressure at zero; the constant keeps that definition local.
      return 'No provider usage recorded yet.\nCurrent context pressure: 0 tokens.'
    /* v8 ignore next 2 -- TokenMeasurementBaseline is closed; a future kind must be given a line here. */
    default:
      return assertNever(baseline)
  }
}

/**
 * Execute one `/usage` invocation against its receiving session.
 * @param ctx - context carrying the token meter.
 * @param invocation - the dispatching command invocation; `rawInput` is ignored.
 * @returns the rendered usage report.
 */
function executeUsage(ctx: Context, invocation: CommandInvocation): CommandResult {
  return {
    kind: 'success',
    text: renderUsage(ctx.tokenMeter.measure(invocation.agent.session)),
  }
}

/**
 * Register `/usage` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the token meter.
 */
export function apply(ctx: Context): void {
  const handler = (invocation: CommandInvocation): CommandResult => executeUsage(ctx, invocation)
  ctx.effect(() => ctx.commands.register({
    name: 'usage',
    description: 'Show provider token usage',
    handler,
  }), 'command-usage lifecycle')
}
