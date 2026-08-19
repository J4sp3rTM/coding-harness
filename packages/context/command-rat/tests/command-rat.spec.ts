import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Scope, ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as CommandRat from '../src/index.ts'

/** Mint one named scope whose ctx resolves the mounted services. */
async function mintScope(ctx: Context, name: string): Promise<Scope> {
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, { name }) },
    { inject: ['systemPrompt'] }))
  return scope
}

/** The key a scope was minted with. */
function scopeKeyOf(scope: Scope): ScopeKey {
  return scopeOf(scope.ctx)!
}

/** A bench with the prompt registry, command runtime, and one entered agent. */
async function boot(config?: CommandRat.Config): Promise<{
  ctx: Context
  agent: Agent
  scope: Scope
  plugin: Awaited<ReturnType<Context['plugin']>>
  run: (line: string, target?: Agent) => Promise<CommandResult | undefined>
  assembled: (target?: Agent, targetScope?: Scope) => Promise<string>
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: 'You are the deployment.' })
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  const plugin = await ctx.plugin(CommandRat, config)
  const scope = await mintScope(ctx, 'agent-scope')
  const session = ctx.sessions.create(SessionId('rat-agent'))
  const agent = { id: session.id, session, options: {}, ctx: scope.ctx } as unknown as Agent
  ctx.agents.enter(agent, undefined)
  ctx.agents.announce(agent)
  const run = async (line: string, target: Agent = agent): Promise<CommandResult | undefined> =>
    (await ctx.commands.execute(target, line, new AbortController().signal))?.result
  const assembled = async (
    target: Agent = agent,
    targetScope: Scope = scope,
  ): Promise<string> => renderPrompt(await ctx.systemPrompt.assemble({
    agent: target,
    scope: scopeKeyOf(targetScope),
  }))
  return { ctx, agent, scope, plugin, run, assembled }
}

describe('@deepseek-ai/dsh-command-rat registration', () => {
  it('registers a Loader-safe command and disposes both command and section', async () => {
    const test = await boot()
    expect(CommandRat.name).toBe('command-rat')
    expect(CommandRat.inject).toEqual(['commands', 'systemPrompt'])
    expect('default' in CommandRat).toBe(false)
    expect(Loader.prototype.unwrapExports(CommandRat)).toBe(CommandRat)
    expect(test.ctx.commands.list(test.agent)).toContainEqual({
      name: 'rat',
      description: 'Append a custom system prompt to this session (run with no text to remove it)',
      input: { hint: 'system prompt text | send empty to remove from System Prompt', required: false },
    })

    await test.run('/rat temporary guidance')
    expect(await test.assembled()).toContain('temporary guidance')
    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'rat')).toBeUndefined()
    expect(await test.assembled()).not.toContain('temporary guidance')
  })
})

describe('/rat', () => {
  it('appends the given text to this agent\'s system prompt', async () => {
    const { run, assembled } = await boot()
    const result = await run('/rat You always answer as a pirate.')
    expect(result).toMatchObject({ kind: 'success' })
    expect(result?.text).toContain('Appended')
    expect(await assembled()).toContain('You always answer as a pirate.')
  })

  it('leaves the deployment persona in place beside the appended text', async () => {
    const { run, assembled } = await boot()
    await run('/rat Extra house rules.')
    const prompt = await assembled()
    expect(prompt).toContain('You are the deployment.')
    expect(prompt).toContain('Extra house rules.')
  })

  it('replaces the text on a second call rather than stacking', async () => {
    const { run, assembled } = await boot()
    await run('/rat first prompt')
    const second = await run('/rat second prompt')
    expect(second?.text).toContain('Replaced')
    const prompt = await assembled()
    expect(prompt).toContain('second prompt')
    expect(prompt).not.toContain('first prompt')
  })

  it('rebuilds the custom section from a replayed session log', async () => {
    const { ctx, agent, run } = await boot()
    await run('/rat durable prompt')
    const replayed = Session.create(SessionId('rat-replayed'), agent.session.events)
    const replayScope = await mintScope(ctx, 'replayed-agent-scope')
    const replayedAgent = {
      id: replayed.id,
      session: replayed,
      options: {},
      ctx: replayScope.ctx,
    } as unknown as Agent
    const prompt = renderPrompt(await ctx.systemPrompt.assemble({
      agent: replayedAgent,
      scope: scopeKeyOf(replayScope),
    }))
    expect(prompt).toContain('durable prompt')
  })

  it('removes the appended prompt when run with no text', async () => {
    const { run, assembled } = await boot()
    await run('/rat temporary prompt')
    expect(await assembled()).toContain('temporary prompt')
    const removal = await run('/rat')
    expect(removal).toMatchObject({ kind: 'success' })
    expect(removal?.text).toContain('removed')
    expect(await assembled()).not.toContain('temporary prompt')
  })

  it('reports usage when run with no text and nothing is active', async () => {
    const { run } = await boot()
    const result = await run('/rat')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result?.text).toContain('Usage: /rat')
  })

  it('rejects prompts larger than the configured UTF-8 limit', async () => {
    const { agent, run } = await boot({ maxBytes: 4 })
    const result = await run('/rat 你好')
    expect(result).toEqual({
      kind: 'error',
      text: 'Custom system prompt is 6 UTF-8 bytes; the configured limit is 4.',
    })
    expect(agent.session.events.some(event => event.type === 'rat/prompt')).toBe(false)
  })

  it('returns the authoritative event sequence in successful results', async () => {
    const { agent, run } = await boot()
    const result = await run('/rat durable prompt')
    const event = agent.session.events.findLast(candidate => candidate.type === 'rat/prompt')
    expect(result?.kind === 'success' ? result.sourceEventSeq : undefined).toBe(event?.seq)
    const done = agent.session.events.findLast(candidate => candidate.type === 'command/done')
    expect(done?.type === 'command/done' && done.data.sourceEventSeq).toBe(event?.seq)
  })

  it('scopes the appended prompt to the receiving agent alone', async () => {
    const { ctx, run, assembled, agent } = await boot()
    await run('/rat agent-only guidance')
    const otherScope = await mintScope(ctx, 'other-agent-scope')
    const otherSession = ctx.sessions.create(SessionId('other-rat-agent'))
    const otherAgent = { id: otherSession.id, session: otherSession, options: {}, ctx: otherScope.ctx } as unknown as Agent
    expect(await assembled(agent)).toContain('agent-only guidance')
    expect(await assembled(otherAgent, otherScope)).not.toContain('agent-only guidance')
  })
})
