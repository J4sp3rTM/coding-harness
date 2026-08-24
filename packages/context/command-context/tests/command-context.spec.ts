import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter'
import {
  createUserMessage, LlmAdapter,
  type LlmResolvedModelInfo, type Message, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as CommandContext from '../src/index.ts'

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

/** Real agent loop, session store, token meter, and the /context command. */
async function boot(): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(CommandContext)
  ctx.llm.registerAdapter([MODEL], new TextAdapter())
  const agent = ctx.agentLoop.create(SessionId('context-agent'), { provider: MODEL, model: MODEL })
  const run = async (line: string): Promise<CommandResult | undefined> =>
    (await ctx.commands.execute(agent, line, new AbortController().signal))?.result
  return { ctx, agent, run }
}

/** Drive one real turn so the session holds model-visible history. */
async function seedTurn(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

/** One fully specified measurement with the fields under test overridden. */
function measurement(overrides: Partial<TokenMeasurement> = {}): TokenMeasurement {
  return {
    logRevision: 0,
    baseline: { kind: 'none', tokens: 0 },
    surfaceDeltaTokens: 0,
    totalTokens: 0,
    surfaceTokens: 0,
    nodes: [],
    ...overrides,
  }
}

describe('@deepseek-ai/dsh-command-context registration', () => {
  it('registers /context once and removes it when the plugin fiber disposes', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TokenMeter)
    await ctx.plugin(CommandRuntime)
    const plugin = await ctx.plugin(CommandContext)
    const agent = ctx.agentLoop.create(SessionId('context-lifecycle'), { provider: MODEL, model: MODEL })

    expect(CommandContext.name).toBe('command-context')
    expect(CommandContext.inject).toEqual(['commands', 'tokenMeter'])
    expect('default' in CommandContext).toBe(false)
    expect(ctx.commands.find(agent, 'context')).toMatchObject({
      name: 'context',
      description: 'Show the current context composition',
    })

    await plugin.dispose()
    expect(ctx.commands.find(agent, 'context')).toBeUndefined()
  })
})

describe('/context', () => {
  it('reports an empty surface with no baseline yet', async () => {
    const { run } = await boot()
    const result = await run('/context')
    expect(result).toEqual({
      kind: 'success',
      text: [
        'Context: 0 surface messages (~0 tokens).',
        'Heaviest node: none.',
        'Request pressure: ~0 tokens (no baseline yet).',
      ].join('\n'),
    })
  })

  it('summarizes a real turn from exactly one live measurement', async () => {
    const { ctx, agent, run } = await boot()
    await seedTurn(agent, 'remember the lighthouse schedule')
    const expected = ctx.tokenMeter.measure(agent.session)
    expect(expected.nodes.length).toBeGreaterThan(1)
    expect(expected.baseline.kind).toBe('estimated')
    const nodeTokens = expected.nodes.map(node => node.tokens)
    const heaviestIndex = nodeTokens.indexOf(Math.max(...nodeTokens))

    const measure = vi.spyOn(ctx.tokenMeter, 'measure')
    try {
      const result = await run('/context')
      if (result?.kind !== 'success' || result.text === undefined) throw new Error('/context failed')
      expect(measure).toHaveBeenCalledTimes(1)
      const lines = result.text.split('\n')
      expect(lines).toHaveLength(3)
      expect(lines[0]).toBe(
        `Context: ${expected.nodes.length} surface messages (~${expected.surfaceTokens} tokens).`,
      )
      expect(lines[1]).toBe(
        `Heaviest node: ~${nodeTokens[heaviestIndex]} tokens at position ${heaviestIndex}.`,
      )
      expect(lines[2]).toBe(
        `Request pressure: ~${expected.totalTokens} tokens (heuristically estimated).`,
      )
    } finally {
      measure.mockRestore()
    }
  })

  it('ignores any arguments after the command name', async () => {
    const { run } = await boot()
    const bare = await run('/context')
    const decorated = await run('/context now --json')
    expect(decorated).toEqual(bare)
    expect(decorated).toMatchObject({ kind: 'success' })
  })
})

describe('renderContext', () => {
  it('labels provider usage and takes the first tied heaviest node', () => {
    const text = CommandContext.renderContext(measurement({
      logRevision: 9,
      baseline: { kind: 'usage', tokens: 4_800, usage: { inputTokens: 4_000, outputTokens: 800 } },
      surfaceDeltaTokens: 350,
      totalTokens: 5_150,
      surfaceTokens: 350,
      nodes: [
        { seq: 2, tokens: 100 },
        { seq: 5, tokens: 300 },
        { seq: 9, tokens: 300 },
      ],
    }))
    expect(text).toBe([
      'Context: 3 surface messages (~350 tokens).',
      'Heaviest node: ~300 tokens at position 1.',
      'Request pressure: ~5150 tokens (measured from provider usage).',
    ].join('\n'))
  })

  it('singularizes one message under an estimated baseline', () => {
    const text = CommandContext.renderContext(measurement({
      logRevision: 2,
      baseline: { kind: 'estimated', tokens: 60 },
      totalTokens: 60,
      surfaceTokens: 42,
      nodes: [{ seq: 11, tokens: 42 }],
    }))
    expect(text).toBe([
      'Context: 1 surface message (~42 tokens).',
      'Heaviest node: ~42 tokens at position 0.',
      'Request pressure: ~60 tokens (heuristically estimated).',
    ].join('\n'))
  })

  it('prices an all-zero single node at its own position', () => {
    const text = CommandContext.renderContext(measurement({
      nodes: [{ seq: 3, tokens: 0 }],
    }))
    expect(text).toBe([
      'Context: 1 surface message (~0 tokens).',
      'Heaviest node: ~0 tokens at position 0.',
      'Request pressure: ~0 tokens (no baseline yet).',
    ].join('\n'))
  })
})
