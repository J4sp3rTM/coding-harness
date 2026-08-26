/**
 * Mid-run operator steering for the delegation tools. A foreground workflow
 * call occupies the whole span between two of the parent's step boundaries, so
 * input the operator sends while the run is in flight is claimed by the parent
 * only after the tool returns. Forwarding hands that input to the running
 * script immediately without consuming it: the message stays in the parent's
 * inbox and reaches the parent model at its normal boundary, so the durable
 * transcript is unchanged and the script gains the only thing it lacked —
 * knowledge that the operator spoke.
 * @module @deepseek-ai/dsh-tool-workflow/steering
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
// Declaration merge only: makes the `agent/inbox/inserted` event visible.
import type {} from '@deepseek-ai/dsh-agent'

/**
 * Flatten one inbox message to the text a script can act on. Non-text blocks
 * (images, tool results) carry no instruction the script could apply and are
 * dropped rather than rendered as placeholders.
 * @param message - the message inserted into the parent's inbox.
 * @returns the joined text blocks, trimmed; empty when the message has none.
 */
export function steeringText(message: UserMessage): string {
  return message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

/**
 * Forward every user-origin message entering the parent's inbox to a running
 * workflow for as long as the returned disposer is held. Plugin- and
 * tool-sourced insertions (injected context, subagent settlement reports) are
 * not operator instructions and are not forwarded.
 * @param ctx - the consumer's context, used to observe the live agent event.
 * @param parent - the agent whose inbox insertions are forwarded; insertions
 *   belonging to any other agent are ignored.
 * @param run - the live run receiving the forwarded text.
 * @param onForward - called after each accepted forward, so a consumer that
 *   owns a durable record can note that this run received mid-run input.
 * @returns the listener disposer; the caller MUST call it when the run ends.
 */
export function forwardSteering(
  ctx: Context,
  parent: Agent,
  run: WorkflowRun,
  onForward?: () => void,
): () => void {
  return ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (agent !== parent) return
    if (message.source.kind !== 'user') return
    const text = steeringText(message)
    if (text.length === 0) return
    if (run.steer(text)) onForward?.()
  })
}
