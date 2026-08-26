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
import type { DeepSeekAccountBalance } from '@deepseek-ai/dsh-llm-deepseek'
import type {
  ProviderPlanWindowSnapshot,
  ProviderQuotaDimensionSnapshot,
  ProviderStatusRecord,
} from '@deepseek-ai/dsh-provider-status'
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

/** Mount a provider-status stand-in answering from one route-keyed record map. */
function provideProviderStatus(ctx: Context, lookup: (routeId: string) => ProviderStatusRecord | undefined): void {
  ctx.reflect.provide('providerStatus', {
    lookup,
    recordSnapshot: () => {},
    recordUnavailable: () => {},
  })
}

/** Mount a deepseek-account stand-in answering every served route with one figure. */
function provideDeepSeekAccount(
  ctx: Context,
  remainingUsd: (provider: string) => Promise<number | undefined>,
): { asked: string[] } {
  const asked: string[] = []
  ctx.reflect.provide('deepseekAccount', {
    remainingUsd: async (provider: string) => {
      asked.push(provider)
      return remainingUsd(provider)
    },
  } satisfies DeepSeekAccountBalance)
  return { asked }
}

describe('/usage', () => {
  it('reports zero pressure on a fresh session', async () => {
    const { run } = await boot()
    expect(await run('/usage')).toEqual({
      kind: 'success',
      text: 'no provider call yet · 0 ctx',
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
    expect(result?.text).toBe(`no provider call yet (estimated) · ${pressure} ctx`)
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
      .toBe('1200 in / 340 out · 1540 ctx')
  })

  it('renders the heuristic notice with current pressure', () => {
    expect(CommandUsage.renderUsage(measurement({ kind: 'estimated', tokens: 96 }, 96)))
      .toBe('no provider call yet (estimated) · 96 ctx')
  })

  it('renders fixed zero pressure without any anchor', () => {
    expect(CommandUsage.renderUsage(measurement({ kind: 'none', tokens: 0 }, 0)))
      .toBe('no provider call yet · 0 ctx')
  })

  it('unregisters on plugin disposal (HMR safety)', async () => {
    const { ctx, agent, plugin } = await boot()
    expect(ctx.commands.find(agent, 'usage')).toBeDefined()
    await plugin.dispose()
    expect(ctx.commands.find(agent, 'usage')).toBeUndefined()
  })
})

describe('renderUsage allowance and balance segments', () => {
  const NOW = 1_756_000_000_000

  function snapshot(
    dimensions: readonly ProviderQuotaDimensionSnapshot[],
    windows: readonly ProviderPlanWindowSnapshot[] = [],
  ): ProviderStatusRecord {
    return { kind: 'snapshot', routeId: 'mock', dimensions, windows, observedAt: NOW - 2_000, source: 'response-headers' }
  }

  it('renders whole-percent remaining per reported dimension in fixed order', () => {
    const record = snapshot([
      { dimension: 'requests', limit: 100, remaining: 98 },
      { dimension: 'tokens', limit: 10_000, remaining: 9_200 },
      { dimension: 'inputTokens', limit: 8_000, remaining: 7_900 },
      { dimension: 'outputTokens', limit: 2_000, remaining: 1_300 },
    ])
    expect(CommandUsage.renderQuotaSegment(record, NOW))
      .toBe('quota 92% tokens left · 98% requests left · 99% input tokens left · 65% output tokens left')
  })

  it('clamps percentages into the 0..100 range', () => {
    const record = snapshot([
      { dimension: 'requests', limit: 10, remaining: 11 },
      { dimension: 'tokens', limit: 10, remaining: -3 },
    ])
    expect(CommandUsage.renderQuotaSegment(record, NOW))
      .toBe('quota 0% tokens left · 100% requests left')
  })

  it('appends a reset countdown from the earliest future reset and skips past resets', () => {
    const record = snapshot([
      { dimension: 'tokens', limit: 100, remaining: 50, reset: NOW + 90_000 },
      { dimension: 'requests', limit: 100, remaining: 40, reset: NOW + 5_400_000 },
    ])
    expect(CommandUsage.renderQuotaSegment(record, NOW))
      .toBe('quota 50% tokens left · 40% requests left · resets in 1m 30s')
    const expired = snapshot([
      { dimension: 'tokens', limit: 100, remaining: 50, reset: NOW - 1_000 },
    ])
    expect(CommandUsage.renderQuotaSegment(expired, NOW)).toBe('quota 50% tokens left')
  })

  it('renders sub-second countdowns as zero without rounding up', () => {
    const record = snapshot([{ dimension: 'requests', limit: 5, remaining: 1, reset: NOW + 400 }])
    expect(CommandUsage.renderQuotaSegment(record, NOW)).toContain('resets in 0s')
  })

  it('renders multi-unit countdowns deterministically', () => {
    const record = snapshot([{ dimension: 'requests', limit: 5, remaining: 1, reset: NOW + 97_200_000 }])
    expect(CommandUsage.renderQuotaSegment(record, NOW)).toContain('resets in 1d 3h')
  })

  it('answers undefined for an unavailable record', () => {
    expect(CommandUsage.renderQuotaSegment({ kind: 'unavailable', routeId: 'mock', observedAt: NOW, reason: 'unparseable' }, NOW))
      .toBeUndefined()
  })

  it('answers undefined for a snapshot carrying only plan windows', () => {
    // A subscription route reports windows and no counter axis; a quota
    // segment built from zero dimensions would claim an empty allowance.
    expect(CommandUsage.renderQuotaSegment(snapshot([], [{ window: '5h', usedPercent: 30 }]), NOW))
      .toBeUndefined()
  })

  it('renders plan windows in stored order with remaining percentages', () => {
    const record = snapshot([], [
      { window: '5h', usedPercent: 6, reset: NOW + 7_680_000 },
      { window: '7d', usedPercent: 10, reset: NOW + 86_400_000 },
    ])
    expect(CommandUsage.renderPlanSegment(record, NOW))
      .toBe('plan 94% left (5h) · 90% left (7d) · resets in 2h 8m')
  })

  it('clamps rounded remaining percentages and selects the earliest future reset', () => {
    const record = snapshot([], [
      { window: 'primary', usedPercent: -4, reset: NOW + 5_400_000 },
      { window: 'secondary', usedPercent: 105, reset: NOW + 90_000 },
      { window: 'expired', usedPercent: 50, reset: NOW - 1_000 },
    ])
    expect(CommandUsage.renderPlanSegment(record, NOW))
      .toBe('plan 100% left (primary) · 0% left (secondary) · 50% left (expired) · resets in 1m 30s')
  })

  it('renders a plan-only snapshot and leaves unavailable records empty', () => {
    const record = snapshot([], [{ window: '5h', usedPercent: 20 }])
    expect(CommandUsage.renderPlanSegment(record, NOW)).toBe('plan 80% left (5h)')
    expect(CommandUsage.renderPlanSegment({ kind: 'unavailable', routeId: 'mock', observedAt: NOW, reason: 'unparseable' }, NOW))
      .toBeUndefined()
  })

  it('leads with plan, then quota, then the session figures and balance', () => {
    const record = snapshot(
      [{ dimension: 'tokens', limit: 100, remaining: 50 }],
      [{ window: '5h', usedPercent: 20 }],
    )
    expect(CommandUsage.renderUsage(measurement({ kind: 'none', tokens: 0 }, 0), { status: record, balanceUsd: 3, now: NOW }))
      .toBe('plan 80% left (5h) · quota 50% tokens left — no provider call yet · 0 ctx · $3.00 left')
  })

  it('appends the balance with two-decimal USD formatting and no allowance segment', () => {
    expect(CommandUsage.renderUsage(measurement({ kind: 'none', tokens: 0 }, 0), { balanceUsd: 12.5 }))
      .toBe('no provider call yet · 0 ctx · $12.50 left')
  })

  it('renders the session figures alone when no context facts are supplied', () => {
    expect(CommandUsage.renderUsage(measurement({ kind: 'estimated', tokens: 96 }, 96), {}))
      .toBe('no provider call yet (estimated) · 96 ctx')
  })
})

describe('/usage with optional provider status services', () => {
  it('appends quota and balance facts for the route the session last requested', async () => {
    const { ctx, agent, run } = await boot()
    await seedTurn(agent, 'anchor a request header on the mock route')
    provideProviderStatus(ctx, routeId => routeId === 'mock'
      ? {
        kind: 'snapshot',
        routeId,
        observedAt: Date.now() - 1_000,
        source: 'response-headers',
        dimensions: [
          { dimension: 'tokens', limit: 10_000, remaining: 9_200 },
          { dimension: 'requests', limit: 100, remaining: 98 },
        ],
        windows: [],
      }
      : undefined)
    const account = provideDeepSeekAccount(ctx, async provider => provider === 'mock' ? 7 : undefined)
    const pressure = ctx.tokenMeter.measure(agent.session).totalTokens

    const result = await run('/usage')
    expect(result).toMatchObject({ kind: 'success' })
    expect(result?.text).toBe(
      'quota 92% tokens left · 98% requests left'
      + ` — no provider call yet (estimated) · ${pressure} ctx · $7.00 left`,
    )
    // The capability was asked exactly about the requested route.
    expect(account.asked).toEqual(['mock'])
  })

  it('reports the switched route rather than the Agent\'s creation-time option', async () => {
    // A composer switch reaches requests through the agent/request waterfall
    // and is logged in the request header, while agent.options keeps the route
    // the Agent was created on. Reading the options would report the wrong
    // provider's allowance for every switched session.
    const { ctx } = await boot()
    ctx.llm.registerAdapter(['switched'], new TextAdapter())
    ctx.on('agent/request', async (_payload, next) => ({
      ...await next(),
      provider: 'switched',
      model: MODEL,
    }))
    provideProviderStatus(ctx, routeId => ({
      kind: 'snapshot',
      routeId,
      observedAt: Date.now(),
      source: 'response-headers',
      dimensions: [],
      windows: [{ window: '5h', usedPercent: routeId === 'switched' ? 20 : 90 }],
    }))
    const agent = ctx.agentLoop.create(SessionId('switched-route-agent'), { provider: MODEL, model: MODEL })
    await seedTurn(agent, 'route this turn through the switched provider')
    expect(agent.session.requestHeader()?.config.provider).toBe('switched')

    const result = await ctx.commands.execute(agent, '/usage', new AbortController().signal)
    expect(result?.result?.text).toContain('plan 80% left (5h)')
  })

  it('leaves the report unchanged for an unavailable or foreign-route record', async () => {
    const { ctx, agent, run } = await boot()
    await seedTurn(agent, 'anchor a request header on the mock route')
    const pressure = ctx.tokenMeter.measure(agent.session).totalTokens
    // One mutable stand-in: each phase swaps what lookup answers.
    let lookup: (routeId: string) => ProviderStatusRecord | undefined = () => undefined
    provideProviderStatus(ctx, route => lookup(route))
    provideDeepSeekAccount(ctx, async () => undefined)

    lookup = routeId => routeId === 'mock'
      ? { kind: 'unavailable', routeId, observedAt: Date.now(), reason: 'unparseable values' }
      : undefined
    const result = await run('/usage')
    expect(result?.text).toBe(`no provider call yet (estimated) · ${pressure} ctx`)

    // A compliant store answers lookups by key, so a record keyed to another
    // route is invisible to this agent's lookup and nothing extra renders.
    lookup = routeId => routeId === 'other'
      ? {
        kind: 'snapshot',
        routeId,
        observedAt: Date.now(),
        source: 'response-headers',
        dimensions: [{ dimension: 'tokens', limit: 100, remaining: 50 }],
        windows: [],
      }
      : undefined
    expect((await run('/usage'))?.text).toBe(`no provider call yet (estimated) · ${pressure} ctx`)
  })

  it('renders the session figures alone when no optional service is composed', async () => {
    const { run } = await boot()
    expect(await run('/usage')).toEqual({
      kind: 'success',
      text: 'no provider call yet · 0 ctx',
    })
  })

  it('skips allowance segments for a session that has requested nothing yet', async () => {
    const { ctx } = await boot()
    provideProviderStatus(ctx, () => ({
      kind: 'snapshot',
      routeId: 'mock',
      observedAt: Date.now(),
      source: 'response-headers',
      dimensions: [{ dimension: 'tokens', limit: 100, remaining: 50 }],
      windows: [],
    }))
    // No request header exists before the first turn, so no route is known and
    // another session's observation for the declared route stays invisible.
    const bare = ctx.agentLoop.create(SessionId('no-request-agent'), { provider: MODEL, model: MODEL })
    const result = await ctx.commands.execute(bare, '/usage', new AbortController().signal)
    expect(result?.result?.text).toBe('no provider call yet · 0 ctx')
  })
})
