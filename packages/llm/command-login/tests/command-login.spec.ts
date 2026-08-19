import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionRequest, UserQuestionProvider } from '@deepseek-ai/dsh-user-questions'
import { MemoryLlmOAuth } from '../../llm-oauth/tests/memory.ts'
import type { LlmOAuthInteraction, LlmOAuthProviderInfo } from '@deepseek-ai/dsh-llm-oauth'

const openAuthorizationUrl = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
vi.mock('../src/browser.ts', () => ({ openAuthorizationUrl }))

import * as CommandLogin from '../src/index.ts'

beforeEach(() => { openAuthorizationUrl.mockClear() })

const ANTHROPIC: LlmOAuthProviderInfo = {
  provider: 'anthropic',
  displayName: 'Anthropic',
  loginLabel: 'Anthropic (Claude Pro/Max)',
}
const CODEX: LlmOAuthProviderInfo = {
  provider: 'openai-codex',
  displayName: 'OpenAI Codex',
  loginLabel: 'OpenAI (ChatGPT Plus/Pro)',
}

/** A questions provider answering with one canned reply and recording what it was asked. */
function questions(answer: string): UserQuestionProvider & { seen: AskUserQuestionRequest[] } {
  const seen: AskUserQuestionRequest[] = []
  return {
    seen,
    ask(request) {
      seen.push(request)
      return Promise.resolve({ answers: [{ id: request.questions[0]?.id ?? 'missing', selected: [], custom: answer }] })
    },
  }
}

/** A live runtime root the questions seam accepts as the human's own agent. */
function liveAgent(ctx: Context, id: string): Agent {
  const session = Session.create(SessionId(id))
  const agent = { id: SessionId(id), session, options: {} } as unknown as Agent
  ctx.agents.enter(agent, undefined)
  ctx.agents.announce(agent)
  return agent
}

/** The command bench: the real registry, the real questions seam, and the memory sign-in provider. */
async function boot(options: {
  answer?: string
  offered?: readonly LlmOAuthProviderInfo[]
} = {}): Promise<{
  ctx: Context
  agent: Agent
  asked: AskUserQuestionRequest[]
  run: (line: string) => Promise<CommandResult | undefined>
}> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(MemoryLlmOAuth, options.offered ?? [ANTHROPIC])
  await ctx.plugin(CommandLogin)
  const asker = questions(options.answer ?? 'pasted-code')
  ctx.userQuestions.registerProvider(asker)
  const agent = liveAgent(ctx, 'agent-1')
  const run = async (line: string): Promise<CommandResult | undefined> =>
    (await ctx.commands.execute(agent, line, new AbortController().signal))?.result
  return { ctx, agent, asked: asker.seen, run }
}

describe('/login', () => {
  it('signs in to the only offered route without asking which one', async () => {
    const { ctx, asked, run } = await boot()
    const result = await run('/login')
    expect(result).toMatchObject({ kind: 'success' })
    expect(result?.text).toBe('Signed in to Anthropic (Claude Pro/Max).')
    expect(await ctx.llmOAuth.status('anthropic')).toMatchObject({ signedIn: true })
    // One question: the flow's own paste prompt, not a route chooser.
    expect(asked).toHaveLength(1)
    expect(asked[0]?.questions[0]?.question).toBe('Paste the redirect URL:')
  })

  it('signs in to the route named on the command line', async () => {
    const { ctx, run } = await boot({ offered: [ANTHROPIC, CODEX] })
    await run('/login openai-codex')
    expect(await ctx.llmOAuth.status('openai-codex')).toMatchObject({ signedIn: true })
    expect(await ctx.llmOAuth.status('anthropic')).toMatchObject({ signedIn: false })
  })

  it('asks which subscription when several are offered and none was named', async () => {
    const { ctx, asked, run } = await boot({ answer: 'openai-codex', offered: [ANTHROPIC, CODEX] })
    await run('/login')
    expect(asked[0]?.questions[0]?.options?.map(option => option.label)).toEqual(['anthropic', 'openai-codex'])
    expect(asked[0]?.questions[0]?.detail).toContain('not signed in')
    expect(await ctx.llmOAuth.status('openai-codex')).toMatchObject({ signedIn: true })
  })

  it('puts the authorization URL in front of the human with the prompt that needs it', async () => {
    const { asked, run } = await boot()
    await run('/login')
    expect(asked[0]?.questions[0]?.detail).toContain('https://example.test/anthropic')
    expect(openAuthorizationUrl).toHaveBeenCalledWith(
      'https://example.test/anthropic',
      expect.any(AbortSignal),
    )
  })

  it('refuses more than one argument', async () => {
    const { run } = await boot()
    expect(await run('/login a b')).toEqual({ kind: 'error', text: 'Usage: /login [provider]' })
  })

  it('reports a route the deployment does not offer', async () => {
    const { run } = await boot()
    const result = await run('/login deepseek')
    expect(result?.kind).toBe('error')
    expect(result?.text).toContain('deepseek')
  })

  it('reports a deployment that offers no sign-in at all', async () => {
    const { run } = await boot({ offered: [] })
    expect(await run('/login')).toEqual({
      kind: 'error',
      text: 'This deployment offers no subscription sign-in.',
    })
  })
})

describe('a flow that asks its own question', () => {
  it('answers a select with the option id the flow minted, not the label it showed', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(UserQuestionService)
    // A flow whose option ids differ from their human labels, as the ChatGPT
    // flow's `browser` / `device_code` choice does.
    const answered: string[] = []
    class SelectingOAuth extends MemoryLlmOAuth {
      override async login(provider: string, surface: LlmOAuthInteraction) {
        answered.push(await surface.prompt({
          kind: 'select',
          message: 'Login method?',
          options: [{ id: 'browser', label: 'Browser login (default)' }, { id: 'device_code', label: 'Device code login' }],
        }))
        return super.login(provider, surface)
      }
    }
    await ctx.plugin(SelectingOAuth)
    await ctx.plugin(CommandLogin)
    // Picks the first offered label, and types free text when nothing is offered.
    ctx.userQuestions.registerProvider({
      ask: (request) => {
        const label = request.questions[0]?.options?.[0]?.label
        return Promise.resolve({
          answers: [label === undefined
            ? { id: 'login', selected: [], custom: 'pasted-code' }
            : { id: 'login', selected: [label] }],
        })
      },
    })
    const agent = liveAgent(ctx, 'agent-3')

    await ctx.commands.execute(agent, '/login anthropic', new AbortController().signal)

    expect(answered).toEqual(['browser'])
  })
})

describe('a flow that only reports a device code', () => {
  it('shows the code while the flow keeps polling', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(UserQuestionService)
    class DeviceCodeOAuth extends MemoryLlmOAuth {
      override async login(provider: string, interaction: LlmOAuthInteraction) {
        interaction.notify({
          kind: 'device-code',
          verificationUri: 'https://example.test/device',
          userCode: 'ABCD-EFGH',
        })
        await Promise.resolve()
        return {
          provider,
          displayName: 'OpenAI Codex',
          loginLabel: 'OpenAI (ChatGPT Plus/Pro)',
          signedIn: true,
        }
      }
    }
    await ctx.plugin(DeviceCodeOAuth, [CODEX])
    await ctx.plugin(CommandLogin)
    const asker = questions('I have entered the code')
    ctx.userQuestions.registerProvider(asker)
    const agent = liveAgent(ctx, 'agent-device-code')

    await ctx.commands.execute(agent, '/login openai-codex', new AbortController().signal)

    expect(asker.seen[0]?.questions[0]?.detail).toContain('ABCD-EFGH')
    expect(openAuthorizationUrl).toHaveBeenCalledWith(
      'https://example.test/device',
      expect.any(AbortSignal),
    )
  })

  it('aborts polling when the human cancels the device-code question', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(UserQuestionService)
    class PollingOAuth extends MemoryLlmOAuth {
      override async login(_provider: string, interaction: LlmOAuthInteraction): Promise<never> {
        interaction.notify({
          kind: 'device-code',
          verificationUri: 'https://example.test/device',
          userCode: 'ABCD-EFGH',
        })
        await new Promise<never>((_resolve, reject) => {
          const signal = interaction.signal
          if (signal === undefined) throw new Error('device-code interaction requires a signal')
          signal.addEventListener('abort', () => { reject(new Error('device-code flow aborted')) }, { once: true })
        })
        throw new Error('unreachable')
      }
    }
    await ctx.plugin(PollingOAuth, [CODEX])
    await ctx.plugin(CommandLogin)
    ctx.userQuestions.registerProvider(questions('Cancel'))
    const agent = liveAgent(ctx, 'agent-device-code-cancel')

    const execution = await ctx.commands.execute(
      agent,
      '/login openai-codex',
      new AbortController().signal,
    )

    expect(execution?.result).toEqual({ kind: 'error', text: 'Sign-in cancelled.' })
  })
})

describe('/logout', () => {
  it('removes a stored sign-in', async () => {
    const { ctx, run } = await boot()
    await run('/login')
    const result = await run('/logout anthropic')
    expect(result?.kind).toBe('success')
    expect(await ctx.llmOAuth.status('anthropic')).toMatchObject({ signedIn: false })
  })

  it('requires exactly one route', async () => {
    const { run } = await boot()
    expect(await run('/logout')).toEqual({ kind: 'error', text: 'Usage: /logout <provider>' })
    expect(await run('/logout a b')).toEqual({ kind: 'error', text: 'Usage: /logout <provider>' })
  })

  it('reports a route the deployment does not offer', async () => {
    const { run } = await boot()
    expect((await run('/logout deepseek'))?.kind).toBe('error')
  })
})

describe('registration lifecycle', () => {
  it('withdraws both commands when the fiber disposes', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(MemoryLlmOAuth)
    const fiber = ctx.plugin(CommandLogin)
    await fiber
    const agent = liveAgent(ctx, 'agent-2')
    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(expect.arrayContaining(['login', 'logout']))
    await fiber.dispose()
    expect(ctx.commands.list(agent).map(command => command.name)).toEqual([])
  })
})
