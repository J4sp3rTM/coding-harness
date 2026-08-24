/**
 * Human-facing `/context` command: one read-only snapshot of the receiving
 * session's model-visible context composition.
 *
 * Each invocation takes a single `ctx.tokenMeter.measure` reading of the
 * agent's session and renders exactly three lines — surface size, heaviest
 * node, and request pressure — without appending to or mutating the session
 * log.
 *
 * @module @deepseek-ai/dsh-command-context
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { TokenMeasurement, TokenSurfaceNode } from '@deepseek-ai/dsh-token-meter'

export const name = 'command-context'
export const inject = ['commands', 'tokenMeter']

/** Human label for each baseline kind, keyed by the closed measurement union. */
const PRESSURE_LABELS: Record<TokenMeasurement['baseline']['kind'], string> = {
  none: 'no baseline yet',
  estimated: 'heuristically estimated',
  usage: 'measured from provider usage',
}

/** One heaviest-node hit: positional index plus its heuristic token count. */
interface HeaviestNode {
  /** Zero-based position in the measured node list. */
  readonly index: number
  /** Heuristic token count at this maximum. */
  readonly tokens: number
}

/**
 * Find the first node carrying the maximum token count.
 * @param nodes - ordered surface nodes of one measurement.
 * @returns the first maximum, or `undefined` when the surface is empty.
 */
function firstHeaviest(nodes: readonly TokenSurfaceNode[]): HeaviestNode | undefined {
  let heaviest: HeaviestNode | undefined
  for (const [index, node] of nodes.entries()) {
    if (heaviest === undefined || node.tokens > heaviest.tokens) {
      heaviest = { index, tokens: node.tokens }
    }
  }
  return heaviest
}

/**
 * Render one `/context` report.
 * @param measurement - detached token-meter snapshot of one session surface.
 * @returns exactly three lines: surface summary, heaviest node, request pressure.
 */
export function renderContext(measurement: TokenMeasurement): string {
  const count = measurement.nodes.length
  const heaviest = firstHeaviest(measurement.nodes)
  return [
    `Context: ${count} surface message${count === 1 ? '' : 's'} (~${measurement.surfaceTokens} tokens).`,
    heaviest === undefined
      ? 'Heaviest node: none.'
      : `Heaviest node: ~${heaviest.tokens} tokens at position ${heaviest.index}.`,
    `Request pressure: ~${measurement.totalTokens} tokens (${PRESSURE_LABELS[measurement.baseline.kind]}).`,
  ].join('\n')
}

/**
 * Execute one `/context` invocation against the receiving agent's session.
 * @param ctx - context carrying the token meter service.
 * @param invocation - the dispatching command invocation; its `rawInput` is
 *   tolerated and ignored because the snapshot takes no arguments.
 * @returns the direct command outcome carrying the rendered report.
 */
function executeContext(ctx: Context, invocation: CommandInvocation): CommandResult {
  return {
    kind: 'success',
    text: renderContext(ctx.tokenMeter.measure(invocation.agent.session)),
  }
}

/**
 * Register `/context` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the token meter service.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'context',
    description: 'Show the current context composition',
    handler: invocation => executeContext(ctx, invocation),
  }), 'command-context lifecycle')
}
