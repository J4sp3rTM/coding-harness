/**
 * Human-facing `/skills` command: list the skills available to the receiving
 * agent, one `• {name} — {description}` row per catalog entry.
 *
 * The command renders one awaited projection of `ctx.skills.list()`; it owns
 * no state and tolerates trailing arguments, which it ignores.
 *
 * @module @deepseek-ai/dsh-command-skills
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'

export const name = 'command-skills'
export const inject = ['commands', 'skills']

const EMPTY_TEXT = 'No skills are available.'
const CANCELLED_TEXT = 'Skills lookup cancelled.'
const MODEL_ONLY_SUFFIX = ' (model-only)'

/**
 * Order two summaries by name for catalog rows.
 * @param left - one summary.
 * @param right - the other summary.
 * @returns `-1` when `left.name` sorts before `right.name`, otherwise `1`;
 *   names are unique in a resolved catalog, so equality cannot occur.
 */
function compareSkillNames(left: SkillSummary, right: SkillSummary): number {
  if (left.name < right.name) return -1
  return 1
}

/**
 * Render the skill catalog as name-sorted plain-text rows.
 * @param skills - invocation-neutral summaries from the skills registry.
 * @returns one `• <name> — <description>` row per skill, ascending by name,
 *   with ` (model-only)` appended when the skill is not user-invocable, or a
 *   fixed sentence for an empty catalog.
 */
export function renderSkills(skills: readonly SkillSummary[]): string {
  if (skills.length === 0) return EMPTY_TEXT
  const sorted = [...skills].sort(compareSkillNames)
  return sorted.map(skill =>
    `• ${skill.name} — ${skill.description}${
      skill.invocation.userInvocable ? '' : MODEL_ONLY_SUFFIX
    }`).join('\n')
}

/**
 * Execute one `/skills` invocation.
 * @param ctx - context carrying the skills service.
 * @param invocation - the dispatching command invocation.
 * @returns the rendered catalog, or an error outcome when the dispatching
 *   request's cancellation aborted the lookup.
 */
async function executeSkills(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  try {
    const skills = await ctx.skills.list({
      cwd: invocation.agent.session.header.cwd,
      scope: invocation.agent,
      signal: invocation.signal,
    })
    return { kind: 'success', text: renderSkills(skills) }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: CANCELLED_TEXT }
    throw error
  }
}

/**
 * Register `/skills` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the skills service.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<CommandResult>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    const operation = executeSkills(ctx, invocation)
    active.add(operation)
    const retire = (): void => { active.delete(operation) }
    void operation.then(retire, retire)
    return operation
  }

  ctx.effect(function* () {
    // LIFO teardown unregisters first, then waits for already-started lookups.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      name: 'skills',
      description: 'List the available skills',
      handler,
    })
  }, 'command-skills lifecycle')
}
