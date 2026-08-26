import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ProviderStatus from '../src/index.ts'
import type { ProviderPlanWindowSnapshot, ProviderQuotaDimensionSnapshot } from '../src/index.ts'

/** One valid dimension to mutate per case. */
function dimension(overrides: Partial<ProviderQuotaDimensionSnapshot> = {}): ProviderQuotaDimensionSnapshot {
  return { dimension: 'tokens', limit: 10_000, remaining: 9_200, ...overrides }
}

/** One valid subscription allowance window to mutate per case. */
function window(overrides: Partial<ProviderPlanWindowSnapshot> = {}): ProviderPlanWindowSnapshot {
  return { window: '5h', usedPercent: 6, reset: 1_787_752_800_000, ...overrides }
}

async function mounted(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ProviderStatus)
  return ctx
}

describe('ProviderStatus', () => {
  it('rejects configuration keys instead of ignoring them', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(ProviderStatus, { stale: true })).rejects.toThrow(/unknown config key "stale"/)
  })

  it('stores and answers the latest snapshot for a route', async () => {
    const ctx = await mounted()
    ctx.providerStatus.recordSnapshot({
      routeId: 'deepseek-official',
      credentialIdentity: 'DEEPSEEK_API_KEY',
      dimensions: [
        dimension({ dimension: 'requests', limit: 100, remaining: 98 }),
        dimension(),
      ],
    })
    const record = ctx.providerStatus.lookup('deepseek-official')
    expect(record).toMatchObject({
      kind: 'snapshot',
      routeId: 'deepseek-official',
      source: 'response-headers',
      credentialIdentity: 'DEEPSEEK_API_KEY',
    })
    expect(record?.kind === 'snapshot' && record.dimensions.map(entry => entry.dimension))
      .toEqual(['requests', 'tokens'])
    expect(typeof (record as { observedAt: number }).observedAt).toBe('number')
  })

  it('stores a windows-only snapshot', async () => {
    const ctx = await mounted()
    ctx.providerStatus.recordSnapshot({ routeId: 'anthropic', windows: [window()] })
    expect(ctx.providerStatus.lookup('anthropic')).toMatchObject({
      kind: 'snapshot',
      dimensions: [],
      windows: [window()],
    })
  })

  it('stores dimensions and plan windows together', async () => {
    const ctx = await mounted()
    ctx.providerStatus.recordSnapshot({ routeId: 'mixed', dimensions: [dimension()], windows: [window()] })
    expect(ctx.providerStatus.lookup('mixed')).toMatchObject({ dimensions: [dimension()], windows: [window()] })
  })

  it('answers undefined before the first publication and for unknown routes', async () => {
    const ctx = await mounted()
    expect(ctx.providerStatus.lookup('deepseek-official')).toBeUndefined()
    ctx.providerStatus.recordUnavailable({
      routeId: 'known',
      credentialIdentity: 'DEEPSEEK_API_KEY',
      reason: 'unparseable values',
    })
    expect(ctx.providerStatus.lookup('other')).toBeUndefined()
    expect(ctx.providerStatus.lookup('known')).toMatchObject({
      kind: 'unavailable',
      credentialIdentity: 'DEEPSEEK_API_KEY',
      reason: 'unparseable values',
    })
  })

  it('replaces the previous record on every publication', async () => {
    const ctx = await mounted()
    ctx.providerStatus.recordSnapshot({ routeId: 'r', dimensions: [dimension()] })
    ctx.providerStatus.recordUnavailable({ routeId: 'r', reason: 'all values invalid' })
    expect(ctx.providerStatus.lookup('r')).toMatchObject({ kind: 'unavailable' })
    ctx.providerStatus.recordSnapshot({ routeId: 'r', dimensions: [dimension({ remaining: 1 })] })
    expect(ctx.providerStatus.lookup('r'))
      .toMatchObject({ kind: 'snapshot', dimensions: [dimension({ remaining: 1 })] })
  })

  it('publishes detached frozen records that later input mutations cannot change', async () => {
    const ctx = await mounted()
    const input = dimension()
    ctx.providerStatus.recordSnapshot({ routeId: 'r', dimensions: [input] })
    input.remaining = 0
    const record = ctx.providerStatus.lookup('r')
    expect(record?.kind === 'snapshot' && record.dimensions[0]?.remaining).toBe(9_200)
    expect(Object.isFrozen(record)).toBe(true)
    expect(() => {
      if (record?.kind !== 'snapshot') throw new Error('expected snapshot')
      ;(record.dimensions[0] as { remaining: number }).remaining = 0
    }).toThrow()
  })

  it('keeps the previous record serving when a publication is rejected', async () => {
    const ctx = await mounted()
    ctx.providerStatus.recordSnapshot({ routeId: 'r', dimensions: [dimension()] })
    const before = ctx.providerStatus.lookup('r')
    expect(() => { ctx.providerStatus.recordSnapshot({
      routeId: 'r',
      dimensions: [dimension({ limit: Number.NaN })],
    }) }).toThrow(/limit must be a positive finite number/)
    expect(ctx.providerStatus.lookup('r')).toBe(before)
  })

  describe('publication validation', () => {
    it('requires a non-empty routeId', async () => {
      const ctx = await mounted()
      expect(() => { ctx.providerStatus.recordSnapshot({ routeId: '', dimensions: [dimension()] }) })
        .toThrow(/routeId must be a non-empty string/)
      expect(() => { ctx.providerStatus.recordUnavailable({ routeId: '', reason: 'x' }) })
        .toThrow(/routeId must be a non-empty string/)
    })

    it('rejects blank credentialIdentity on both publication kinds', async () => {
      const ctx = await mounted()
      expect(() => { ctx.providerStatus.recordSnapshot({
        routeId: 'r',
        credentialIdentity: '',
        dimensions: [dimension()],
      }) }).toThrow(/credentialIdentity must be a non-empty string/)
      expect(() => { ctx.providerStatus.recordUnavailable({
        routeId: 'r',
        credentialIdentity: '',
        reason: 'x',
      }) }).toThrow(/credentialIdentity must be a non-empty string/)
    })

    it('requires at least one dimension or plan window in a snapshot', async () => {
      const ctx = await mounted()
      expect(() => { ctx.providerStatus.recordSnapshot({ routeId: 'r', dimensions: [], windows: [] }) })
        .toThrow(/at least one quota dimension or plan window/)
    })

    it('rejects unknown dimension names', async () => {
      const ctx = await mounted()
      expect(() => { ctx.providerStatus.recordSnapshot({
        routeId: 'r',
        dimensions: [dimension({ dimension: 'credits' as never })],
      }) }).toThrow(/unknown quota dimension "credits"/)
    })

    it.each([
      ['zero', 0],
      ['negative', -5],
      ['non-finite', Number.POSITIVE_INFINITY],
      ['NaN', Number.NaN],
    ])('rejects a %s limit', async (_label, limit) => {
      const ctx = await mounted()
      expect(() => { ctx.providerStatus.recordSnapshot({
        routeId: 'r',
        dimensions: [dimension({ limit })],
      }) }).toThrow(/limit must be a positive finite number/)
    })

    it.each([
      ['negative', -1],
      ['non-finite', Number.NEGATIVE_INFINITY],
      ['NaN', Number.NaN],
    ])('rejects a %s remaining value', async (_label, remaining) => {
      const ctx = await mounted()
      expect(() => { ctx.providerStatus.recordSnapshot({
        routeId: 'r',
        dimensions: [dimension({ remaining })],
      }) }).toThrow(/remaining must be a finite non-negative number/)
    })

    it('stores zero remaining without reading it as an absent observation', async () => {
      const ctx = await mounted()
      ctx.providerStatus.recordSnapshot({ routeId: 'r', dimensions: [dimension({ remaining: 0 })] })
      const record = ctx.providerStatus.lookup('r')
      expect(record?.kind === 'snapshot' && record.dimensions[0]?.remaining).toBe(0)
    })

    it.each([
      ['negative', -1_000],
      ['non-finite', Number.NaN],
    ])('rejects a %s reset time', async (_label, reset) => {
      const ctx = await mounted()
      expect(() => { ctx.providerStatus.recordSnapshot({
        routeId: 'r',
        dimensions: [dimension({ reset })],
      }) }).toThrow(/reset must be a finite non-negative epoch-ms number/)
    })

    it('rejects one dimension published twice', async () => {
      const ctx = await mounted()
      expect(() => { ctx.providerStatus.recordSnapshot({
        routeId: 'r',
        dimensions: [dimension(), dimension({ limit: 5 })],
      }) }).toThrow(/"tokens" is published more than once/)
    })

    it('rejects one plan window published twice', async () => {
      const ctx = await mounted()
      expect(() => { ctx.providerStatus.recordSnapshot({
        routeId: 'r',
        windows: [window(), window({ usedPercent: 20 })],
      }) }).toThrow(/"5h" is published more than once/)
    })

    it.each([
      ['negative', -1],
      ['over 100', 101],
      ['non-finite', Number.POSITIVE_INFINITY],
      ['NaN', Number.NaN],
    ])('rejects %s plan-window usedPercent', async (_label, usedPercent) => {
      const ctx = await mounted()
      expect(() => { ctx.providerStatus.recordSnapshot({
        routeId: 'r',
        windows: [window({ usedPercent })],
      }) }).toThrow(/usedPercent must be a finite number from 0 through 100/)
    })

    it.each([
      ['negative', -1],
      ['non-finite', Number.NaN],
    ])('rejects %s plan-window reset', async (_label, reset) => {
      const ctx = await mounted()
      expect(() => { ctx.providerStatus.recordSnapshot({
        routeId: 'r',
        windows: [window({ reset })],
      }) }).toThrow(/reset must be a finite non-negative epoch-ms number/)
    })

    it('requires a non-empty unavailability reason', async () => {
      const ctx = await mounted()
      expect(() => { ctx.providerStatus.recordUnavailable({ routeId: 'r', reason: '' }) })
        .toThrow(/reason must be a non-empty string/)
    })
  })
})
