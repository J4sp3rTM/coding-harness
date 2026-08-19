/**
 * Human-facing `/clear` command: drop the model's conversation context while
 * keeping the same session.
 *
 * `/clear` shadows the entire model-visible surface behind one durable,
 * fixed checkpoint, exactly as compaction shadows a summarized range. Earlier
 * events remain in the append-only log; only the derived surface changes.
 *
 * @module @deepseek-ai/dsh-command-clear
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session'
import { CLEAR_CHECKPOINT, CLEAR_PLUGIN_NAME } from './constants.ts'

export const name = 'command-clear'
export const inject = ['commands', 'sessions']

const USAGE = 'Usage: /clear (no arguments)'
const BUSY_TEXT = 'Cannot clear while the agent is working. Wait for it to finish, then try again.'

/**
 * Execute one `/clear` invocation.
 * @param ctx - context carrying the session store.
 * @param invocation - the dispatching command invocation.
 * @returns the direct command outcome.
 */
async function executeClear(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim().length > 0) {
    return { kind: 'error', text: USAGE }
  }
  const agent = invocation.agent
  // The replacement is an idle-phase mutation of the surface: refuse it while a
  // turn is in flight rather than race the driver appending to the same log.
  if (agent.status !== 'idle') {
    return { kind: 'error', text: BUSY_TEXT }
  }
  try {
    return await agent.runMaintenance(async (signal): Promise<CommandResult> => {
      signal.throwIfAborted()
      const surface = [...agent.session.surface.nodes]
      if (surface.length === 0) {
        return { kind: 'success', text: 'The context is already empty; nothing to clear.' }
      }
      // The whole surface is a complete, tool-pairing-balanced span by
      // construction, so shadowing first..last can never orphan a tool call.
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const start = surface[0]!
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const end = surface[surface.length - 1]!
      const checkpoint = createUserMessage({
        content: [{ type: 'text', text: CLEAR_CHECKPOINT }],
        source: { kind: 'plugin', plugin: CLEAR_PLUGIN_NAME },
      })
      const event = agent.session.append('user/message', checkpoint, {
        surfaceOp: { op: 'replace', start, end },
        sourceEventSeqs: surface,
      })
      // Make the checkpoint durable before reporting success, so a crash right
      // after the acknowledgement cannot resurrect the cleared context.
      await ctx.sessions.flush(agent.session)
      const count = surface.length
      return {
        kind: 'success',
        text: `Cleared ${count} message${count === 1 ? '' : 's'} from the context.`
          + ' The session and its full history are preserved.',
        sourceEventSeq: event.seq,
      }
    })
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Clear cancelled.' }
    if (error instanceof Error && error.message === `agent "${agent.id}" already has active work`) {
      return { kind: 'error', text: BUSY_TEXT }
    }
    throw error
  }
}

/**
 * Register `/clear` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the session store.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<CommandResult>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    const operation = executeClear(ctx, invocation)
    active.add(operation)
    const retire = (): void => { active.delete(operation) }
    void operation.then(retire, retire)
    return operation
  }

  ctx.effect(function* () {
    // Yield drain before registration: composite teardown is LIFO, so no new
    // invocation can enter while already-started handler promises quiesce.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      name: 'clear',
      description: 'Clear the conversation context but keep the session',
      handler,
    })
  }, 'command-clear lifecycle')
}
