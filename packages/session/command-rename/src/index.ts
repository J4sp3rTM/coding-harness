/**
 * Human-facing `/rename` command: pin one explicit title on the receiving
 * session through the log-backed session-title service.
 *
 * The accepted rename is the durable `session/title` event appended by
 * `@deepseek-ai/dsh-session-title`; this package only translates the command
 * outcome, so the reported `sourceEventSeq` points at that authoritative event.
 *
 * @module @deepseek-ai/dsh-command-rename
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import {
  SessionTitleInvalidError,
  type SessionTitleService,
} from '@deepseek-ai/dsh-session-title'

export const name = 'command-rename'
export const inject = ['commands', 'sessionTitle']

const USAGE = 'Usage: /rename <new title>'

/**
 * Execute one `/rename` invocation.
 * @param sessionTitle - service that normalizes, appends, and pins the title.
 * @param invocation - the dispatching command invocation.
 * @returns the direct command outcome.
 */
function executeRename(
  sessionTitle: SessionTitleService,
  invocation: CommandInvocation,
): CommandResult {
  const title = invocation.rawInput.trim()
  if (title.length === 0) return { kind: 'error', text: USAGE }
  try {
    const snapshot = sessionTitle.rename(invocation.agent.session, title)
    return {
      kind: 'success',
      text: `Renamed this session to "${snapshot.title}".`,
      sourceEventSeq: snapshot.eventSeq,
    }
  } catch (error: unknown) {
    // Only the input-blaming rejection becomes a direct result; every other
    // failure (disposed service, dead session) stays a thrown Error for the
    // registry's renderer.
    if (error instanceof SessionTitleInvalidError) return { kind: 'error', text: error.message }
    throw error
  }
}

/**
 * Register `/rename` for every composed human-command adapter. The input hint
 * lets capable UIs collect a title on a bare `/rename`.
 * @param ctx - context carrying the command registry and the session-title service.
 */
export function apply(ctx: Context): void {
  const handler = (invocation: CommandInvocation): CommandResult =>
    executeRename(ctx.sessionTitle, invocation)

  ctx.effect(() => ctx.commands.register({
    name: 'rename',
    description: 'Rename this session',
    input: { hint: 'New title for this session' },
    handler,
  }), 'command-rename lifecycle')
}
