import { describe, expect, it } from 'vitest'
import { normalizeRateLimitHeaders } from '../src/rate-limits.ts'

const NOW = 1_000_000_000_000

describe('normalizeRateLimitHeaders', () => {
  it('maps a full OpenAI header set onto requests and tokens dimensions', () => {
    expect(normalizeRateLimitHeaders(false, {
      'x-ratelimit-limit-requests': '60',
      'x-ratelimit-remaining-requests': '59',
      'x-ratelimit-reset-requests': '1s',
      'x-ratelimit-limit-tokens': '100000',
      'x-ratelimit-remaining-tokens': '99940',
      'x-ratelimit-reset-tokens': '6m0s',
      'x-request-id': 'ignored',
    }, NOW)).toEqual({
      kind: 'snapshot',
      windows: [],
      dimensions: [
        { dimension: 'requests', limit: 60, remaining: 59, reset: NOW + 1_000 },
        { dimension: 'tokens', limit: 100_000, remaining: 99_940, reset: NOW + 360_000 },
      ],
    })
  })

  it('maps a full Anthropic header set including input/output token variants', () => {
    const iso = '2026-08-25T12:00:00Z'
    expect(normalizeRateLimitHeaders(false, {
      'anthropic-ratelimit-requests-limit': '50',
      'anthropic-ratelimit-requests-remaining': '49',
      'anthropic-ratelimit-requests-reset': iso,
      'anthropic-ratelimit-tokens-limit': '200000',
      'anthropic-ratelimit-tokens-remaining': '190000',
      'anthropic-ratelimit-tokens-reset': iso,
      'anthropic-ratelimit-input-tokens-limit': '150000',
      'anthropic-ratelimit-input-tokens-remaining': '140000',
      'anthropic-ratelimit-output-tokens-limit': '50000',
      'anthropic-ratelimit-output-tokens-remaining': '49000',
    }, NOW)).toEqual({
      kind: 'snapshot',
      windows: [],
      dimensions: [
        { dimension: 'requests', limit: 50, remaining: 49, reset: Date.parse(iso) },
        { dimension: 'tokens', limit: 200_000, remaining: 190_000, reset: Date.parse(iso) },
        { dimension: 'inputTokens', limit: 150_000, remaining: 140_000 },
        { dimension: 'outputTokens', limit: 50_000, remaining: 49_000 },
      ],
    })
  })

  it('reads allowlisted names case-insensitively', () => {
    expect(normalizeRateLimitHeaders(false, {
      'X-RateLimit-Limit-Requests': '10',
      'X-RateLimit-Remaining-Requests': '5',
    }, NOW)).toEqual({
      kind: 'snapshot',
      windows: [],
      dimensions: [{ dimension: 'requests', limit: 10, remaining: 5 }],
    })
  })

  it('keeps documented counter headers observable on subscription routes', () => {
    expect(normalizeRateLimitHeaders(true, {
      'x-ratelimit-limit-requests': '60',
      'x-ratelimit-remaining-requests': '59',
    }, NOW)).toEqual({
      kind: 'snapshot',
      windows: [],
      dimensions: [{ dimension: 'requests', limit: 60, remaining: 59 }],
    })
  })

  it('normalizes Anthropic OAuth plan windows', () => {
    expect(normalizeRateLimitHeaders(true, {
      'anthropic-ratelimit-unified-5h-utilization': '0.06',
      'anthropic-ratelimit-unified-5h-reset': '1787752800',
      'anthropic-ratelimit-unified-7d-utilization': '0.1',
      'anthropic-ratelimit-unified-7d-reset': '1788274800',
      'anthropic-ratelimit-unified-status': 'allowed',
    }, NOW)).toEqual({
      kind: 'snapshot',
      dimensions: [],
      windows: [
        { window: '5h', usedPercent: 6, reset: 1787752800000 },
        { window: '7d', usedPercent: 10, reset: 1788274800000 },
      ],
    })
  })

  it('normalizes Codex windows and falls back when duration headers are absent', () => {
    expect(normalizeRateLimitHeaders(true, {
      'x-codex-primary-used-percent': '15',
      'x-codex-primary-window-minutes': '300',
      'x-codex-primary-reset-at': '1787743391',
      'x-codex-secondary-used-percent': '3',
      'x-codex-secondary-window-minutes': '10080',
      'x-codex-secondary-reset-at': '1788292246',
      'x-codex-plan-type': 'plus',
    }, NOW)).toEqual({
      kind: 'snapshot',
      dimensions: [],
      windows: [
        { window: '5h', usedPercent: 15, reset: 1787743391000 },
        { window: '7d', usedPercent: 3, reset: 1788292246000 },
      ],
    })
    expect(normalizeRateLimitHeaders(true, {
      'x-codex-primary-used-percent': '15',
      'x-codex-secondary-used-percent': '3',
    }, NOW)).toMatchObject({
      kind: 'snapshot',
      windows: [{ window: 'primary', usedPercent: 15 }, { window: 'secondary', usedPercent: 3 }],
    })
  })

  it('drops invalid plan-window usage and reset-only windows', () => {
    expect(normalizeRateLimitHeaders(true, {
      'x-codex-primary-used-percent': '101',
      'x-codex-secondary-used-percent': 'not-a-number',
      'x-codex-primary-reset-at': '1787743391',
    }, NOW)).toEqual({
      kind: 'unavailable',
      reason: 'rate-limit headers were present but carried no parseable values',
    })
  })

  it('answers undefined when no allowlisted header is present', () => {
    expect(normalizeRateLimitHeaders(false, {
      'x-request-id': 'abc',
      'retry-after': '30',
      'anthropic-version': '2023-06-01',
    }, NOW)).toBeUndefined()
    expect(normalizeRateLimitHeaders(false, {}, NOW)).toBeUndefined()
  })

  it('keeps partial sets usable without inventing values for missing fields', () => {
    // Remaining alone cannot yield a percentage; the dimension is dropped and
    // never zero-filled.
    expect(normalizeRateLimitHeaders(false, {
      'x-ratelimit-remaining-tokens': '42',
    }, NOW)).toEqual({
      kind: 'unavailable',
      reason: 'rate-limit headers were present but carried no parseable values',
    })
    expect(normalizeRateLimitHeaders(false, {
      'x-ratelimit-limit-requests': '30',
      'x-ratelimit-limit-tokens': '90000',
      'x-ratelimit-remaining-tokens': '89000',
    }, NOW)).toEqual({
      kind: 'snapshot',
      windows: [],
      dimensions: [{ dimension: 'tokens', limit: 90_000, remaining: 89_000 }],
    })
  })

  it('drops dimensions whose numbers are invalid and reports all-unusable as unavailable', () => {
    expect(normalizeRateLimitHeaders(false, {
      'x-ratelimit-limit-requests': 'not-a-number',
      'x-ratelimit-remaining-requests': '-5',
      'x-ratelimit-limit-tokens': '',
    }, NOW)).toEqual({
      kind: 'unavailable',
      reason: 'rate-limit headers were present but carried no parseable values',
    })
    // One valid pair survives beside an invalid one.
    expect(normalizeRateLimitHeaders(false, {
      'x-ratelimit-limit-requests': 'NaN',
      'x-ratelimit-limit-tokens': '90000',
      'x-ratelimit-remaining-tokens': '1',
    }, NOW)).toEqual({
      kind: 'snapshot',
      windows: [],
      dimensions: [{ dimension: 'tokens', limit: 90_000, remaining: 1 }],
    })
  })

  it('omits resets it cannot parse instead of guessing', () => {
    expect(normalizeRateLimitHeaders(false, {
      'x-ratelimit-limit-requests': '60',
      'x-ratelimit-remaining-requests': '59',
      'x-ratelimit-reset-requests': 'soon',
    }, NOW)).toEqual({
      kind: 'snapshot',
      windows: [],
      dimensions: [{ dimension: 'requests', limit: 60, remaining: 59 }],
    })
    expect(normalizeRateLimitHeaders(false, {
      'anthropic-ratelimit-requests-limit': '60',
      'anthropic-ratelimit-requests-remaining': '59',
      'anthropic-ratelimit-requests-reset': 'yesterday maybe',
    }, NOW)).toEqual({
      kind: 'snapshot',
      windows: [],
      dimensions: [{ dimension: 'requests', limit: 60, remaining: 59 }],
    })
  })

  it('parses compound OpenAI durations and rejects malformed ones', () => {
    expect(normalizeRateLimitHeaders(false, {
      'x-ratelimit-limit-tokens': '1000',
      'x-ratelimit-remaining-tokens': '900',
      'x-ratelimit-reset-tokens': '1d2h3m4.5s',
    }, NOW)).toEqual({
      kind: 'snapshot',
      windows: [],
      dimensions: [{
        dimension: 'tokens',
        limit: 1_000,
        remaining: 900,
        reset: NOW + ((1 * 24 + 2) * 60 + 3) * 60_000 + 4_500,
      }],
    })
  })

  it('refuses a reset duration whose components overflow to a non-finite value', () => {
    expect(normalizeRateLimitHeaders(false, {
      'x-ratelimit-limit-tokens': '1000',
      'x-ratelimit-remaining-tokens': '900',
      'x-ratelimit-reset-tokens': `${'9'.repeat(400)}d`,
    }, NOW)).toEqual({
      kind: 'snapshot',
      windows: [],
      dimensions: [{ dimension: 'tokens', limit: 1_000, remaining: 900 }],
    })
  })
})
