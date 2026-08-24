import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { TokenMeasurement, TokenMeasurementBaseline } from '@deepseek-ai/dsh-token-meter'
import {
  createUserMessage,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type Message,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as CommandUsage from '../src/index.ts'

const MODEL = 'mock'

/** One canned text answer per request; the finish chunk carries no usage. */
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

/** Real agent loop, session store, token meter, command registry, and /usage. */
async function boot(): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(CommandRuntime)
  const plugin = await ctx.plugin(CommandUsage)
  ctx.llm.registerAdapter([MODEL], new TextAdapter())
  const agent = ctx.agentLoop.create(SessionId('usage-agent'), { provider: MODEL, model: MODEL })
  const run = async (line: string): Promise<CommandResult | undefined> =>
    (await ctx.commands.execute(agent, line, new AbortController().signal))?.result
  return { ctx, agent, plugin, run }
}

/** Drive one real turn so the session holds model-visible history. */
async function seedTurn(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

/** One complete measurement fixture carrying only the fields rendering reads. */
function measurement(baseline: TokenMeasurementBaseline, totalTokens: number): TokenMeasurement {
  return {
    logRevision: 0,
    baseline,
    surfaceDeltaTokens: 0,
    totalTokens,
    surfaceTokens: 0,
    nodes: [],
  }
}

describe('/usage', () => {
  it('reports zero pressure on a fresh session', async () => {
    const { run } = await boot()
    expect(await run('/usage')).toEqual({
      kind: 'success',
      text: 'No provider usage recorded yet.\nCurrent context pressure: 0 tokens.',
    })
  })

  it('reports the heuristic price after a turn without provider usage', async () => {
    const { ctx, agent, run } = await boot()
    await seedTurn(agent, 'please remember the number seven')
    // The mock adapter logs no usage, so the meter anchors heuristically; the
    // command/run events a dispatch appends are log-only and never reprice it.
    const pressure = ctx.tokenMeter.measure(agent.session).totalTokens
    expect(pressure).toBeGreaterThan(0)

    const result = await run('/usage')
    expect(result).toMatchObject({ kind: 'success' })
    expect(result?.text).toBe(
      'No provider usage recorded yet — the latest call was priced heuristically.'
      + `\nCurrent context pressure: ${pressure} tokens.`,
    )
  })

  it('ignores arguments after the command name', async () => {
    const { run } = await boot()
    const plain = await run('/usage')
    expect(plain).toMatchObject({ kind: 'success' })
    expect(await run('/usage\t with trailing words ')).toEqual(plain)
  })
})

describe('renderUsage', () => {
  it('renders disjoint provider input and output counts', () => {
    const usage: TokenUsage = { inputTokens: 1200, outputTokens: 340 }
    expect(CommandUsage.renderUsage(measurement({ kind: 'usage', tokens: 1540, usage }, 1540)))
      .toBe('Latest provider call: 1200 input / 340 output tokens.\nCurrent context pressure: 1540 tokens.')
  })

  it('renders the heuristic notice with current pressure', () => {
    expect(CommandUsage.renderUsage(measurement({ kind: 'estimated', tokens: 96 }, 96)))
      .toBe('No provider usage recorded yet — the latest call was priced heuristically.\nCurrent context pressure: 96 tokens.')
  })

  it('renders fixed zero pressure without any anchor', () => {
    expect(CommandUsage.renderUsage(measurement({ kind: 'none', tokens: 0 }, 0)))
      .toBe('No provider usage recorded yet.\nCurrent context pressure: 0 tokens.')
  })

  it('unregisters on plugin disposal (HMR safety)', async () => {
    const { ctx, agent, plugin } = await boot()
    expect(ctx.commands.find(agent, 'usage')).toBeDefined()
    await plugin.dispose()
    expect(ctx.commands.find(agent, 'usage')).toBeUndefined()
  })
})
