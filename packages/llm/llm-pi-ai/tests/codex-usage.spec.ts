import { describe, expect, it } from 'vitest'
import { CODEX_USAGE_URL, harvestCodexUsage, parseCodexUsage } from '../src/codex-usage.ts'

const BODY = {
  plan_type: 'plus',
  rate_limit: {
    primary_window: { used_percent: 15, limit_window_seconds: 18_000, reset_at: 1_787_743_391 },
    secondary_window: { used_percent: '3', limit_window_seconds: '604800', reset_at: 1_788_292_246 },
  },
}

describe('parseCodexUsage', () => {
  it('maps primary and secondary windows to plan percentages', () => {
    expect(parseCodexUsage(BODY)).toEqual({
      windows: [
        { window: '5h', usedPercent: 15, reset: 1_787_743_391_000 },
        { window: '7d', usedPercent: 3, reset: 1_788_292_246_000 },
      ],
    })
  })

  it('keeps an unknown duration identifiable and ignores unusable windows', () => {
    expect(parseCodexUsage({
      rate_limit: {
        primary_window: { used_percent: 101, limit_window_seconds: 18_000 },
        secondary_window: { used_percent: 20, limit_window_seconds: 3_600 },
      },
    })).toEqual({ windows: [{ window: 'secondary', usedPercent: 20 }] })
    expect(parseCodexUsage({ rate_limit: {} })).toBeUndefined()
    expect(parseCodexUsage({})).toBeUndefined()
  })
})

describe('harvestCodexUsage', () => {
  it('GETs the endpoint with the OAuth token and optional account id', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const signal = new AbortController().signal
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, init })
      return new Response(JSON.stringify(BODY), { status: 200 })
    }
    const result = await harvestCodexUsage('token-x', signal, 'account-7', fetchImpl)
    expect(result?.windows[0]?.window).toBe('5h')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(CODEX_USAGE_URL)
    expect(calls[0]?.init?.method).toBe('GET')
    expect(calls[0]?.init?.signal).toBe(signal)
    expect(calls[0]?.init?.headers).toEqual({
      authorization: 'Bearer token-x',
      accept: 'application/json',
      'user-agent': 'codex-cli',
      'chatgpt-account-id': 'account-7',
    })
  })

  it('returns undefined for refused or malformed responses', async () => {
    const refused = async (): Promise<Response> => new Response('nope', { status: 403 })
    await expect(harvestCodexUsage('token-x', new AbortController().signal, undefined, refused))
      .resolves.toBeUndefined()
    const malformed = async (): Promise<Response> => new Response('{not-json', { status: 200 })
    await expect(harvestCodexUsage('token-x', new AbortController().signal, undefined, malformed))
      .resolves.toBeUndefined()
  })
})
