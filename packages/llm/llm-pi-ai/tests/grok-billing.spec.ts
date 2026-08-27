import { describe, expect, it } from 'vitest'
import { GROK_BILLING_URL, harvestGrokBilling, parseGrokBilling } from '../src/grok-billing.ts'

const WEEKLY = {
  config: {
    currentPeriod: {
      type: 'USAGE_PERIOD_TYPE_WEEKLY',
      start: '2026-08-20T11:20:25.958790+00:00',
      end: '2026-08-27T11:20:25.958790+00:00',
    },
    creditUsagePercent: 85,
    prepaidBalance: { val: 0 },
  },
}

describe('parseGrokBilling', () => {
  it('maps weekly creditUsagePercent and period end', () => {
    expect(parseGrokBilling(WEEKLY)).toEqual({
      windows: [{
        window: '7d',
        usedPercent: 85,
        reset: Date.parse('2026-08-27T11:20:25.958790+00:00'),
      }],
    })
  })

  it('maps a monthly period label and clamps over-100 percent', () => {
    expect(parseGrokBilling({
      config: {
        current_period: { type: 'USAGE_PERIOD_TYPE_MONTHLY', end: '2026-09-01T00:00:00+00:00' },
        credit_usage_percent: 140,
      },
    })).toEqual({
      windows: [{
        window: '30d',
        usedPercent: 100,
        reset: Date.parse('2026-09-01T00:00:00+00:00'),
      }],
    })
  })

  it('labels an unknown period as plan and omits an unparseable reset', () => {
    expect(parseGrokBilling({ config: { creditUsagePercent: 10, currentPeriod: { type: 'OTHER' } } }))
      .toEqual({ windows: [{ window: 'plan', usedPercent: 10 }] })
  })

  it('rejects bodies without a usable percentage', () => {
    expect(parseGrokBilling(null)).toBeUndefined()
    expect(parseGrokBilling({})).toBeUndefined()
    expect(parseGrokBilling({ config: {} })).toBeUndefined()
    expect(parseGrokBilling({ config: { creditUsagePercent: -1 } })).toBeUndefined()
  })
})

describe('harvestGrokBilling', () => {
  it('GETs the billing URL with the subscription token and returns parsed windows', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, init })
      return new Response(JSON.stringify(WEEKLY), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const parsed = await harvestGrokBilling('token-x', new AbortController().signal, fetchImpl)
    expect(calls[0]?.url).toBe(GROK_BILLING_URL)
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer token-x')
    expect(parsed?.windows[0]?.usedPercent).toBe(85)
  })

  it('returns undefined when the endpoint refuses', async () => {
    const fetchImpl = async (): Promise<Response> => new Response('nope', { status: 403 })
    await expect(harvestGrokBilling('token-x', new AbortController().signal, fetchImpl)).resolves.toBeUndefined()
  })

  it('returns undefined for a successful response with malformed JSON', async () => {
    const fetchImpl = async (): Promise<Response> => new Response('{not-json', { status: 200 })
    await expect(harvestGrokBilling('token-x', new AbortController().signal, fetchImpl)).resolves.toBeUndefined()
  })
})
