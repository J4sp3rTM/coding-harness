/**
 * Human-facing `/help` command: list every command the receiving agent can
 * resolve, one `/{name} — {description}` row per registration.
 * @module @deepseek-ai/dsh-command-help
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

export const name = 'command-help'
export const inject = ['commands']

/**
 * Execute one `/help` invocation.
 * @param ctx - context carrying the command registry.
 * @param invocation - the dispatching command invocation.
 * @returns the direct command outcome.
 */
function executeHelp(ctx: Context, invocation: CommandInvocation): CommandResult {
  const rows = ctx.commands.list(invocation.agent)
    .map(command => `/${command.name} — ${command.description}`)
  return { kind: 'success', text: rows.join('\n') }
}

/**
 * Register `/help` for every composed human-command adapter.
 * @param ctx - context carrying the command registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'help',
    description: 'List the available commands',
    handler: invocation => executeHelp(ctx, invocation),
  }), 'command-help lifecycle')
}
