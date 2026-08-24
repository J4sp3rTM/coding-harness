/**
 * Human-facing `/status` command: report the receiving agent's session
 * identity, lifecycle state, and model-visible context size.
 *
 * `/status` is a read-only live view: it appends no events, ignores any
 * trailing input, and renders exactly one line from the receiving agent's
 * current state.
 *
 * @module @deepseek-ai/dsh-command-status
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'command-status'
export const inject = ['commands']

/**
 * Render the one-line `/status` report for one agent's current state.
 * @param id - the receiving agent's session identity.
 * @param status - the agent's lifecycle state at reporting time.
 * @param surfaceNodes - the number of messages on the agent's model-visible surface.
 * @returns the exact single-line status text, with `message` singularized at exactly one node.
 */
export function renderStatus(id: SessionId, status: AgentStatus, surfaceNodes: number): string {
  return `Session ${id} — agent is ${status}. Context holds ${surfaceNodes} message${surfaceNodes === 1 ? '' : 's'}.`
}

/**
 * Execute one `/status` invocation.
 * @param invocation - the dispatching command invocation.
 * @returns the direct command outcome carrying the rendered status line.
 */
function executeStatus(invocation: CommandInvocation): CommandResult {
  return {
    kind: 'success',
    text: renderStatus(invocation.agent.id, invocation.agent.status, invocation.agent.session.surface.nodes.length),
  }
}

/**
 * Register `/status` for every composed human-command adapter.
 * @param ctx - context carrying the command registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'status',
    description: 'Show this session\'s status',
    handler: invocation => executeStatus(invocation),
  }), 'command-status lifecycle')
}
