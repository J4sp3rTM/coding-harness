import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import {
  createUserMessage, LlmAdapter,
  type LlmResolvedModelInfo, type Message, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as CommandClear from '../src/index.ts'

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
  run: (line: string) => Promise<CommandResult | undefined>
}

/** Real agent loop, session store, token meter, and the /clear command. */
async function boot(): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(CommandClear)
  ctx.llm.registerAdapter([MODEL], new TextAdapter())
  const agent = ctx.agentLoop.create(SessionId('clear-agent'), { provider: MODEL, model: MODEL })
  const run = async (line: string): Promise<CommandResult | undefined> =>
    (await ctx.commands.execute(agent, line, new AbortController().signal))?.result
  return { ctx, agent, run }
}

/** Drive one real turn so the session holds model-visible history. */
async function seedTurn(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

/** The concatenated text of every model-visible message. */
function derivedText(session: Session): string {
  return session.deriveMessages()
    .flatMap(message => message.content.map(block => block.type === 'text' ? block.text : ''))
    .join('\n')
}

describe('/clear', () => {
  it('shadows the whole conversation behind one checkpoint', async () => {
    const { agent, run } = await boot()
    await seedTurn(agent, 'remember the pawn structure')
    expect(agent.session.deriveMessages().length).toBeGreaterThan(1)

    const result = await run('/clear')
    expect(result).toMatchObject({ kind: 'success' })
    expect(result?.text).toContain('Cleared')
    const checkpoint = agent.session.events.findLast(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'clear')
    expect(result?.kind === 'success' ? result.sourceEventSeq : undefined).toBe(checkpoint?.seq)

    const messages = agent.session.deriveMessages()
    expect(messages).toHaveLength(1)
    expect(derivedText(agent.session)).toContain('cleared at the user\'s request')
    expect(derivedText(agent.session)).not.toContain('remember the pawn structure')
  })

  it('keeps the full durable log even though context is cleared', async () => {
    const { agent, run } = await boot()
    await seedTurn(agent, 'a memorable original prompt')
    const before = agent.session.events.length
    await run('/clear')
    // History is preserved: the original events remain, plus the checkpoint.
    expect(agent.session.events.length).toBeGreaterThan(before)
    expect(agent.session.events.some(event =>
      event.type === 'user/message'
      && event.data.content.some(block => block.type === 'text' && block.text.includes('a memorable original prompt')))).toBe(true)
  })

  it('lets the next turn continue from the cleared checkpoint', async () => {
    const { agent, run } = await boot()
    await seedTurn(agent, 'first subject')
    await run('/clear')
    await seedTurn(agent, 'second subject')
    const text = derivedText(agent.session)
    expect(text).toContain('second subject')
    expect(text).not.toContain('first subject')
  })

  it('reports nothing to clear on an empty session', async () => {
    const { run } = await boot()
    const result = await run('/clear')
    expect(result).toMatchObject({ kind: 'success' })
    expect(result?.text).toContain('already empty')
  })

  it('maps a maintenance admission race to a direct busy result', async () => {
    const { agent, run } = await boot()
    const original = agent.runMaintenance.bind(agent)
    agent.runMaintenance = () => {
      throw new Error(`agent "${agent.id}" already has active work`)
    }
    try {
      const result = await run('/clear')
      expect(result).toEqual({
        kind: 'error',
        text: 'Cannot clear while the agent is working. Wait for it to finish, then try again.',
      })
    } finally {
      agent.runMaintenance = original
    }
  })

  it('rejects arguments', async () => {
    const { agent, run } = await boot()
    await seedTurn(agent, 'some history')
    const result = await run('/clear now')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result?.text).toContain('Usage: /clear')
  })
})
