import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import {
  createUserMessage, LlmAdapter,
  type LlmResolvedModelInfo, type Message, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { renderStatus } from '../src/index.ts'
import * as CommandStatus from '../src/index.ts'

const MODEL = 'mock'

/** One canned text answer per request. */
class TextAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 100_000 } })
  }

  override async * stream(_options: { messages: readonly Message[] }): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'assistant answer' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

interface Harness {
  ctx: Context
  agent: Agent
  plugin: Awaited<ReturnType<Context['plugin']>>
  run: (line: string) => Promise<CommandResult | undefined>
}

/** Real agent loop, session store, command registry, and the /status command. */
async function boot(): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(CommandRuntime)
  const plugin = await ctx.plugin(CommandStatus)
  ctx.llm.registerAdapter([MODEL], new TextAdapter())
  const agent = ctx.agentLoop.create(SessionId('status-agent'), { provider: MODEL, model: MODEL })
  const run = async (line: string): Promise<CommandResult | undefined> =>
    (await ctx.commands.execute(agent, line, new AbortController().signal))?.result
  return { ctx, agent, plugin, run }
}

/** Drive one real turn so the surface holds model-visible history. */
async function seedTurn(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

describe('/status', () => {
  it('reports an empty context on a fresh session', async () => {
    const { agent, run } = await boot()
    expect(agent.session.surface.nodes.length).toBe(0)
    const result = await run('/status')
    expect(result).toEqual({
      kind: 'success',
      text: 'Session status-agent — agent is idle. Context holds 0 messages.',
    })
  })

  it('reports the real message count after a completed turn', async () => {
    const { agent, run } = await boot()
    await seedTurn(agent, 'remember the pawn structure')
    const nodes = agent.session.surface.nodes.length
    expect(nodes).toBeGreaterThan(1)
    const result = await run('/status')
    expect(result).toEqual({
      kind: 'success',
      text: `Session status-agent — agent is idle. Context holds ${nodes} messages.`,
    })
  })

  it('singularizes the message count at exactly one node', () => {
    expect(renderStatus(SessionId('solo-agent'), 'idle', 1))
      .toBe('Session solo-agent — agent is idle. Context holds 1 message.')
  })

  it('reports a running agent through the same renderer', () => {
    expect(renderStatus(SessionId('busy-agent'), 'running', 4))
      .toBe('Session busy-agent — agent is running. Context holds 4 messages.')
  })

  it('ignores any trailing input', async () => {
    const { run } = await boot()
    const bare = await run('/status')
    const trailing = await run('/status trailing words here')
    expect(trailing).toEqual(bare)
    expect(trailing).toEqual({
      kind: 'success',
      text: 'Session status-agent — agent is idle. Context holds 0 messages.',
    })
  })

  it('unregisters on plugin disposal (HMR safety)', async () => {
    const { ctx, agent, plugin } = await boot()
    expect(ctx.commands.find(agent, 'status')).toBeDefined()
    await plugin.dispose()
    expect(ctx.commands.find(agent, 'status')).toBeUndefined()
  })
})
