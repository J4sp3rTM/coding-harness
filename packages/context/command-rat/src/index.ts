/**
 * Human-facing `/rat` command: append a durable custom system prompt to the
 * current session without touching the deployment persona.
 *
 * The selected text is recorded as a last-wins session event. The prompt
 * section reads that event fold during assembly, so a resumed session rebuilds
 * the same model-visible input without a process-local mirror.
 *
 * @module @deepseek-ai/dsh-command-rat
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  DEFAULT_MAX_PROMPT_BYTES,
  RAT_PROMPT_EVENT,
  RAT_SECTION_NAME,
  RAT_SECTION_ORDER,
} from './constants.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Last-wins custom system-prompt value; null removes the section. */
    'rat/prompt': { text: string | null }
  }
}

export const name = 'command-rat'
export const inject = ['commands', 'systemPrompt']

/** Configures the complete UTF-8 size limit for one custom prompt. */
export interface Config {
  /** Maximum UTF-8 bytes accepted by `/rat <text>`. */
  maxBytes?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  maxBytes: z.number().default(DEFAULT_MAX_PROMPT_BYTES),
})

const USAGE = 'Usage: /rat <system prompt text>  (run /rat with no text to remove it)'

/**
 * Fold the latest durable custom system prompt.
 *
 * @param events - session events in log order.
 * @returns the current prompt, or `undefined` when no prompt is active.
 */
export function foldRatPrompt(events: readonly SessionEvent[]): string | undefined {
  let prompt: string | undefined
  for (const event of events) {
    if (event.type !== RAT_PROMPT_EVENT) continue
    prompt = event.data.text === null ? undefined : event.data.text
  }
  return prompt
}

/** Resolve and validate the complete prompt byte limit. */
function resolveMaxBytes(config: Config | undefined): number {
  const maxBytes = config?.maxBytes ?? DEFAULT_MAX_PROMPT_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('command-rat: maxBytes must be a positive safe integer')
  }
  return maxBytes
}

/** Count the exact UTF-8 bytes that will enter the durable JSON event. */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

/** Execute one `/rat` invocation against the receiving session. */
function executeRat(maxBytes: number, invocation: CommandInvocation): CommandResult {
  const session = invocation.agent.session
  const current = foldRatPrompt(session.events)
  const text = invocation.rawInput.trim()

  if (text.length === 0) {
    if (current === undefined) return { kind: 'error', text: USAGE }
    const event = session.append(RAT_PROMPT_EVENT, { text: null })
    return {
      kind: 'success',
      text: 'Custom system prompt removed. It stops applying from the next turn.',
      sourceEventSeq: event.seq,
    }
  }

  const bytes = utf8Bytes(text)
  if (bytes > maxBytes) {
    return {
      kind: 'error',
      text: `Custom system prompt is ${bytes} UTF-8 bytes; the configured limit is ${maxBytes}.`,
    }
  }

  const event = session.append(RAT_PROMPT_EVENT, { text })
  return {
    kind: 'success',
    text: `${current === undefined ? 'Appended' : 'Replaced'} a custom system prompt (${text.length} characters).`
      + ' It applies from the next turn; /rat with no text removes it.',
    sourceEventSeq: event.seq,
  }
}

/**
 * Register `/rat` and the durable prompt section.
 * @param ctx - context carrying the command registry and prompt registry.
 * @param config - optional maximum prompt size.
 */
export function apply(ctx: Context, config?: Config): void {
  const maxBytes = resolveMaxBytes(config)

  ctx.effect(() => ctx.systemPrompt.section({
    name: RAT_SECTION_NAME,
    order: RAT_SECTION_ORDER,
    text: ({ agent }) => agent === undefined
      ? ''
      : foldRatPrompt(agent.session.events) ?? '',
  }), 'command-rat prompt section')

  ctx.effect(() => ctx.commands.register({
    name: 'rat',
    description: 'Append a custom system prompt to this session (run with no text to remove it)',
    input: { hint: 'system prompt text | send empty to remove from System Prompt', required: false },
    handler: invocation => executeRat(maxBytes, invocation),
  }), 'command-rat command')
}
