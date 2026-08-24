import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as CommandHelp from '../src/index.ts'

interface Harness {
  ctx: Context
  agent: Agent
  plugin: Awaited<ReturnType<Context['plugin']>>
  run: (line: string) => Promise<CommandResult | undefined>
}

/** Real agent loop, session store, command registry, and the /help command. */
async function boot(): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(CommandRuntime)
  const plugin = await ctx.plugin(CommandHelp)
  const agent = ctx.agentLoop.create(SessionId('help-agent'), { provider: 'mock', model: 'mock' })
  const run = async (line: string): Promise<CommandResult | undefined> =>
    (await ctx.commands.execute(agent, line, new AbortController().signal))?.result
  return { ctx, agent, plugin, run }
}

describe('/help', () => {
  it('lists itself when it is the only registration', async () => {
    const { run } = await boot()
    const result = await run('/help')
    expect(result).toEqual({ kind: 'success', text: '/help — List the available commands' })
  })

  it('renders one row per registration in name-sorted order', async () => {
    const { ctx, agent, run } = await boot()
    ctx.commands.register({ name: 'zebra', description: 'Last alphabetically', handler: () => ({ kind: 'success' }) })
    ctx.commands.register({ name: 'alpha', description: 'First alphabetically', handler: () => ({ kind: 'success' }) })
    const result = await run('/help')
    expect(result).toEqual({
      kind: 'success',
      text: [
        '/alpha — First alphabetically',
        '/help — List the available commands',
        '/zebra — Last alphabetically',
      ].join('\n'),
    })
    expect(agent.status).toBe('idle')
  })

  it('ignores any trailing input', async () => {
    const { run } = await boot()
    const result = await run('/help me choose a command')
    expect(result).toEqual({ kind: 'success', text: '/help — List the available commands' })
  })

  it('unregisters on plugin disposal (HMR safety)', async () => {
    const { ctx, agent, plugin } = await boot()
    expect(ctx.commands.find(agent, 'help')).toBeDefined()
    await plugin.dispose()
    expect(ctx.commands.find(agent, 'help')).toBeUndefined()
  })
})
