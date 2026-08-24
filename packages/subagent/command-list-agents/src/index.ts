/**
 * Human-facing `/list-agents` command: list the direct subagent children of
 * the receiving session.
 *
 * The command is a presentation adapter over `ctx.subagents.listChildren()`:
 * it renders the runtime-ordered entries as human rows — a child's label falls
 * back to its durable id, diagnostics are shown instead of silently dropped —
 * and tolerates stray arguments because the listing itself takes none.
 *
 * @module @deepseek-ai/dsh-command-list-agents
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SubagentListEntry } from '@deepseek-ai/dsh-subagent'

export const name = 'command-list-agents'
export const inject = ['commands', 'subagents']

/** Human output for a session that has started no subagents. */
const EMPTY_TEXT = 'No subagents have been started from this session.'

/** Human output returned when the dispatching UI request cancels the listing. */
const CANCELLED_TEXT = 'Subagent lookup cancelled.'

/**
 * Render one listing entry as its human-readable row.
 * @param entry - one runtime entry: an interpreted child or a per-child diagnostic.
 * @returns `• <label ?? id> — <mode>, <activity>` plus `, has subagents` for a
 *   child with durable descendants, or `• <id> — unavailable (<reason>)` for a
 *   diagnostic.
 */
function renderEntry(entry: SubagentListEntry): string {
  if (entry.kind === 'diagnostic') return `• ${entry.id} — unavailable (${entry.reason})`
  const facts: string[] = [entry.mode, entry.activity]
  if (entry.hasChildren) facts.push('has subagents')
  return `• ${entry.label ?? entry.id} — ${facts.join(', ')}`
}

/**
 * Render a subagent listing as the command's human-facing text.
 * @param entries - entries in the runtime's order (`createdAt`, then id).
 * @returns one row per entry joined by newlines, preserving that order, or the
 *   fixed empty-catalog sentence when the parent has no children or diagnostics.
 */
export function renderAgents(entries: readonly SubagentListEntry[]): string {
  if (entries.length === 0) return EMPTY_TEXT
  return entries.map(renderEntry).join('\n')
}

/**
 * Execute one `/list-agents` invocation against the subagent seam. The
 * invocation's `rawInput` is ignored: `/list-agents` takes no arguments.
 * @param ctx - context carrying the subagent service.
 * @param invocation - the dispatching command invocation whose receiving agent
 *   identifies the listed parent session.
 * @returns the rendered listing, or the cancellation result when the caller aborted.
 * @throws the listing's own failure when the invocation has not been aborted.
 */
async function executeListAgents(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  try {
    const entries = await ctx.subagents.listChildren(invocation.agent.id, invocation.signal)
    return { kind: 'success', text: renderAgents(entries) }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: CANCELLED_TEXT }
    throw error
  }
}

/**
 * Register `/list-agents` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the subagent service.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<CommandResult>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    const operation = executeListAgents(ctx, invocation)
    active.add(operation)
    const retire = (): void => { active.delete(operation) }
    void operation.then(retire, retire)
    return operation
  }
  ctx.effect(function* () {
    // LIFO teardown unregisters first, then waits for already-started lookups.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      name: 'list-agents',
      description: 'List this session\u2019s subagents',
      handler,
    })
  }, 'command-list-agents lifecycle')
}
