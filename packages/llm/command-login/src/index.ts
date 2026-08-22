/**
 * Human-facing `/login` and `/logout` commands over the subscription sign-in
 * seam.
 *
 * Sign-in is a conversation, not a form: the flow hands out an authorization
 * URL or device code and asks for any choice or redirect URL it needs. The
 * command hands HTTPS sign-in targets to a local desktop browser when one is
 * available, while every interaction still reaches the human through the
 * user-questions seam as the fallback and remote-host path.
 *
 * The commands are argument-tolerant by design: `/login` with no route asks
 * which one, and `/login anthropic` goes straight there.
 *
 * @module @deepseek-ai/dsh-command-login
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
// Imported for its `Context` declaration merging: this package reaches the
// user-questions seam through `ctx.userQuestions` and names none of its types.
import type {} from '@deepseek-ai/dsh-user-questions'
import { isHarnessError } from '@deepseek-ai/dsh-llm'
import type {
  LlmOAuthEvent,
  LlmOAuthInteraction,
  LlmOAuthPrompt,
} from '@deepseek-ai/dsh-llm-oauth'
import { openAuthorizationUrl } from './browser.ts'

export const name = 'command-login'
export const inject = ['commands', 'llmOAuth', 'userQuestions']

const LOGIN_USAGE = 'Usage: /login [provider]'
const LOGOUT_USAGE = 'Usage: /logout <provider>'

/** One question put to the human, with the option labels the answer maps back through. */
interface Question {
  /** The question text. */
  question: string
  /** Supporting text rendered with the question. */
  detail?: string
  /** Offered labels; an empty list asks for free text. */
  options: readonly { label: string; description?: string }[]
}

/** Interaction plus the operation-local lifecycle owned by one command. */
interface CommandInteraction {
  /** Surface passed to the provider flow. */
  interaction: LlmOAuthInteraction
  /** Whether the human cancelled through a progress question. */
  cancelled(): boolean
  /** Dismiss any progress question after the provider flow settles. */
  close(): Promise<void>
}

/**
 * Ask the human one question through the user-questions seam.
 * @param ctx - context carrying the user-questions seam.
 * @param agent - the live agent whose UI receives the question.
 * @param question - the question to put.
 * @param signal - cancels the question with the surrounding command.
 * @returns the chosen label, or the typed text when the human wrote their own.
 * @throws Error when the human answered nothing.
 */
async function ask(
  ctx: Context,
  agent: Agent,
  question: Question,
  signal: AbortSignal,
): Promise<string> {
  const answer = await ctx.userQuestions.ask({
    questions: [{
      id: 'login',
      question: question.question,
      ...question.detail === undefined ? {} : { detail: question.detail },
      ...question.options.length === 0 ? {} : { options: [...question.options] },
    }],
    agent,
    signal,
  })
  const item = answer.answers.find(entry => entry.id === 'login')
  const chosen = item?.custom ?? item?.selected[0]
  if (chosen === undefined || chosen.length === 0) throw new Error('no answer')
  return chosen
}

/** Render one flow event as the text a surface shows beside the next question. */
function renderEvent(event: LlmOAuthEvent): string {
  switch (event.kind) {
    case 'auth-url':
      return `Open this URL to sign in:\n${event.url}${event.instructions === undefined ? '' : `\n\n${event.instructions}`}`
    case 'device-code':
      return `Open ${event.verificationUri} and enter the code ${event.userCode}.`
    case 'progress':
      return event.message
    case 'info':
      return [event.message, ...(event.links ?? []).map(link => `${link.label ?? 'Link'}: ${link.url}`)].join('\n')
    /* v8 ignore next 2 -- merge-extensible seam union: an added member contributes no text. */
    default: return ''
  }
}

/**
 * A sign-in surface over the user-questions seam.
 *
 * Most flow events are accumulated into the next provider prompt. A device
 * code has no following prompt: the provider polls while the human enters the
 * code, so it opens an acknowledgement question immediately. Authorization
 * and verification URLs are also handed to a local desktop browser. Completing
 * the provider flow dismisses the question; cancelling it aborts the flow.
 * @param ctx - context carrying the user-questions seam.
 * @param agent - the live agent whose UI receives the questions.
 * @param signal - cancels every question with the surrounding command.
 * @returns the interaction and its operation-local lifecycle.
 */
function commandInteraction(ctx: Context, agent: Agent, signal: AbortSignal): CommandInteraction {
  const pending: string[] = []
  const flowAbort = new AbortController()
  const flowSignal = AbortSignal.any([signal, flowAbort.signal])
  const progressAbort = new AbortController()
  let progress: Promise<void> | undefined
  let cancelled = false
  const opened = new Set<string>()
  const launches = new Set<Promise<void>>()
  const launch = (url: string): void => {
    if (opened.has(url)) return
    opened.add(url)
    const operation = openAuthorizationUrl(url, flowSignal).then(
      () => {},
      (error: unknown) => {
        if (flowSignal.aborted) return
        ctx.logger.warn('command-login: could not open the provider sign-in page automatically: %s', String(error))
      },
    )
    launches.add(operation)
    void operation.finally(() => { launches.delete(operation) })
  }
  const interaction: LlmOAuthInteraction = {
    signal: flowSignal,
    notify: (event): void => {
      const text = renderEvent(event)
      if (text.length === 0) return
      if (event.kind === 'auth-url') launch(event.url)
      if (event.kind === 'device-code') launch(event.verificationUri)
      pending.push(text)
      if (event.kind !== 'device-code' || progress !== undefined) return
      const detail = pending.join('\n\n')
      pending.length = 0
      const questionSignal = AbortSignal.any([flowSignal, progressAbort.signal])
      progress = ask(ctx, agent, {
        question: 'Complete sign-in in your browser.',
        detail,
        options: [
          { label: 'I have entered the code' },
          { label: 'Cancel' },
        ],
      }, questionSignal).then(
        (answer) => {
          if (answer !== 'Cancel') return
          cancelled = true
          flowAbort.abort(new Error('sign-in cancelled'))
        },
        (error: unknown) => {
          if (progressAbort.signal.aborted || signal.aborted) return
          cancelled = true
          flowAbort.abort(error)
        },
      )
    },
    prompt: async (prompt: LlmOAuthPrompt) => {
      const detail = pending.join('\n\n')
      pending.length = 0
      const questionSignal = prompt.signal === undefined ? signal : AbortSignal.any([signal, prompt.signal])
      const answer = await ask(ctx, agent, {
        question: prompt.message,
        ...detail.length === 0 ? {} : { detail },
        options: prompt.kind === 'select' ? prompt.options.map(option => ({
          label: option.label,
          ...option.description === undefined ? {} : { description: option.description },
        })) : [],
      }, questionSignal)
      if (prompt.kind !== 'select') return answer
      // The questions seam answers with the label a human read; the flow
      // matches on the option id it minted, and the two differ wherever a
      // flow labels its choices for people (`browser` shown as "Browser login
      // (default)"). An unmatched answer is the human's own text, which the
      // flow judges for itself.
      return prompt.options.find(option => option.label === answer)?.id ?? answer
    },
  }
  return {
    interaction,
    cancelled: () => cancelled,
    close: async () => {
      progressAbort.abort()
      if (progress !== undefined) await progress
      await Promise.all(launches)
    },
  }
}

/**
 * Resolve which route the human meant: the one they typed, or the one they
 * pick from the offer.
 * @param ctx - context carrying the sign-in and user-questions seams.
 * @param invocation - the dispatching command invocation.
 * @param typed - the route named on the command line, when any.
 * @returns the chosen provider route key.
 */
async function chooseProvider(
  ctx: Context,
  invocation: CommandInvocation,
  typed: string,
): Promise<string> {
  if (typed.length > 0) return typed
  const accounts = await ctx.llmOAuth.accounts()
  const only = accounts.length === 1 ? accounts[0] : undefined
  if (only !== undefined) return only.provider
  const chosen = await ask(ctx, invocation.agent, {
    question: 'Which subscription do you want to sign in with?',
    options: accounts.map(account => ({ label: account.provider, description: account.loginLabel })),
  }, invocation.signal)
  return chosen
}

/**
 * Convert an expected seam failure into a human-only outcome; anything else
 * belongs to the command runtime's own failure rendering.
 * @param error - the thrown value.
 * @returns the command result, or `undefined` when the failure is not expected here.
 */
function expectedFailure(error: unknown): CommandResult | undefined {
  if (!isHarnessError(error)) return undefined
  switch (error.code) {
    case 'UNKNOWN_PROVIDER':
      return { kind: 'error', text: error.message }
    case 'LOGIN_ABORTED':
      return { kind: 'error', text: 'Sign-in cancelled.' }
    case 'LOGIN_FAILED':
      return { kind: 'error', text: `Sign-in did not complete: ${error.message}` }
    default:
      return undefined
  }
}

/**
 * Run one `/login` invocation.
 * @param ctx - context carrying the sign-in and user-questions seams.
 * @param invocation - the dispatching command invocation.
 * @returns the human-facing outcome.
 */
async function executeLogin(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const typed = invocation.rawInput.trim()
  if (typed.split(/\s+/u).filter(part => part.length > 0).length > 1) {
    return { kind: 'error', text: LOGIN_USAGE }
  }
  const offered = ctx.llmOAuth.providers()
  if (offered.length === 0) {
    return { kind: 'error', text: 'This deployment offers no subscription sign-in.' }
  }
  const surface = commandInteraction(ctx, invocation.agent, invocation.signal)
  try {
    const provider = await chooseProvider(ctx, invocation, typed)
    const account = await ctx.llmOAuth.login(
      provider,
      surface.interaction,
    )
    return {
      kind: 'success',
      text: `Signed in to ${account.loginLabel}.`,
    }
  } catch (error: unknown) {
    if (invocation.signal.aborted || surface.cancelled()) return { kind: 'error', text: 'Sign-in cancelled.' }
    const expected = expectedFailure(error)
    if (expected !== undefined) return expected
    throw error
  } finally {
    await surface.close()
  }
}

/**
 * Run one `/logout` invocation.
 * @param ctx - context carrying the sign-in seam.
 * @param invocation - the dispatching command invocation.
 * @returns the human-facing outcome.
 */
async function executeLogout(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const typed = invocation.rawInput.trim()
  if (typed.length === 0 || typed.split(/\s+/u).length > 1) {
    return { kind: 'error', text: LOGOUT_USAGE }
  }
  try {
    await ctx.llmOAuth.logout(typed)
    // Name the route the way `/login` named it: the human read a display
    // name going in, so they should read the same one coming out.
    const known = ctx.llmOAuth.providers().find(info => info.provider === typed)
    return {
      kind: 'success',
      text: `Signed out of ${known?.displayName ?? typed}.`,
    }
  } catch (error: unknown) {
    const expected = expectedFailure(error)
    if (expected !== undefined) return expected
    throw error
  }
}

/**
 * Register `/login` and `/logout` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the sign-in seam.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<CommandResult>>()
  const track = (operation: Promise<CommandResult>): Promise<CommandResult> => {
    active.add(operation)
    const retire = (): void => { active.delete(operation) }
    // Both branches retire without rethrowing, so the derived observer promise
    // cannot become an unhandled mirror of an expected handler rejection.
    void operation.then(retire, retire)
    return operation
  }

  ctx.effect(function* () {
    // Yield drain before registration: composite teardown is LIFO, so no new
    // invocation can enter while already-started handler promises quiesce.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      name: 'login',
      description: 'Sign in to a provider subscription (Claude Pro/Max, ChatGPT Plus/Pro)',
      input: { hint: 'provider route, e.g. anthropic', required: false },
      handler: invocation => track(executeLogin(ctx, invocation)),
    })
    yield ctx.commands.register({
      name: 'logout',
      description: 'Remove this machine\'s stored subscription sign-in for a provider',
      input: { hint: 'provider route, e.g. anthropic' },
      handler: invocation => track(executeLogout(ctx, invocation)),
    })
  }, 'command-login lifecycle')
}
