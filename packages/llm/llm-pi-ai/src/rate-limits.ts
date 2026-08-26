/**
 * Response-header → provider-status normalizer for the pi-ai adapter.
 *
 * Only documented rate-limit headers are read: OpenAI's `x-ratelimit-*` and
 * Anthropic's `anthropic-ratelimit-*` families. Everything else is ignored,
 * and no raw header value leaves this module except as a validated numeric
 * dimension. Reset values are parsed only where the provider documents the
 * format (OpenAI sends relative durations like `6m0s`; Anthropic sends an
 * ISO 8601 timestamp); an unparseable reset is omitted rather than guessed.
 *
 * Subscription/OAuth routes are observed through their documented plan-window
 * headers when present. Counter headers and plan windows are separate facts.
 *
 * @module dsh-llm-pi-ai/rate-limits
 */

import type {
  ProviderPlanWindowSnapshot,
  ProviderQuotaDimension,
  ProviderQuotaDimensionSnapshot,
} from '@deepseek-ai/dsh-provider-status'

/** What one response's allowlisted headers normalize to. */
export type NormalizedRateLimit =
  | { kind: 'snapshot'; dimensions: ProviderQuotaDimensionSnapshot[]; windows: ProviderPlanWindowSnapshot[] }
  | { kind: 'unavailable'; reason: string }

/** One allowlisted header binding onto a quota-axis field. */
type HeaderBinding = {
  dimension: ProviderQuotaDimension
  field: 'limit' | 'remaining'
} | {
  dimension: ProviderQuotaDimension
  field: 'reset'
  /** Wire format of the reset value; decides how it turns into a timestamp. */
  format: 'openai-duration' | 'iso-timestamp'
}

type PlanWindowBinding = {
  window: '5h' | '7d' | 'primary' | 'secondary'
  field: 'usedPercent' | 'reset' | 'windowMinutes'
  format?: 'fraction' | 'epoch-seconds'
}

/**
 * Every header name this adapter reads, keyed by lowercase wire name. Names
 * outside this table are never forwarded anywhere.
 */
const BINDINGS: Readonly<Record<string, HeaderBinding>> = {
  'x-ratelimit-limit-requests': { dimension: 'requests', field: 'limit' },
  'x-ratelimit-remaining-requests': { dimension: 'requests', field: 'remaining' },
  'x-ratelimit-reset-requests': { dimension: 'requests', field: 'reset', format: 'openai-duration' },
  'x-ratelimit-limit-tokens': { dimension: 'tokens', field: 'limit' },
  'x-ratelimit-remaining-tokens': { dimension: 'tokens', field: 'remaining' },
  'x-ratelimit-reset-tokens': { dimension: 'tokens', field: 'reset', format: 'openai-duration' },
  'anthropic-ratelimit-requests-limit': { dimension: 'requests', field: 'limit' },
  'anthropic-ratelimit-requests-remaining': { dimension: 'requests', field: 'remaining' },
  'anthropic-ratelimit-requests-reset': { dimension: 'requests', field: 'reset', format: 'iso-timestamp' },
  'anthropic-ratelimit-tokens-limit': { dimension: 'tokens', field: 'limit' },
  'anthropic-ratelimit-tokens-remaining': { dimension: 'tokens', field: 'remaining' },
  'anthropic-ratelimit-tokens-reset': { dimension: 'tokens', field: 'reset', format: 'iso-timestamp' },
  'anthropic-ratelimit-input-tokens-limit': { dimension: 'inputTokens', field: 'limit' },
  'anthropic-ratelimit-input-tokens-remaining': { dimension: 'inputTokens', field: 'remaining' },
  'anthropic-ratelimit-input-tokens-reset': { dimension: 'inputTokens', field: 'reset', format: 'iso-timestamp' },
  'anthropic-ratelimit-output-tokens-limit': { dimension: 'outputTokens', field: 'limit' },
  'anthropic-ratelimit-output-tokens-remaining': { dimension: 'outputTokens', field: 'remaining' },
  'anthropic-ratelimit-output-tokens-reset': { dimension: 'outputTokens', field: 'reset', format: 'iso-timestamp' },
}

const WINDOW_BINDINGS: Readonly<Record<string, PlanWindowBinding>> = {
  'anthropic-ratelimit-unified-5h-utilization': { window: '5h', field: 'usedPercent', format: 'fraction' },
  'anthropic-ratelimit-unified-5h-reset': { window: '5h', field: 'reset', format: 'epoch-seconds' },
  'anthropic-ratelimit-unified-7d-utilization': { window: '7d', field: 'usedPercent', format: 'fraction' },
  'anthropic-ratelimit-unified-7d-reset': { window: '7d', field: 'reset', format: 'epoch-seconds' },
  'x-codex-primary-used-percent': { window: 'primary', field: 'usedPercent' },
  'x-codex-primary-window-minutes': { window: 'primary', field: 'windowMinutes' },
  'x-codex-primary-reset-at': { window: 'primary', field: 'reset', format: 'epoch-seconds' },
  'x-codex-secondary-used-percent': { window: 'secondary', field: 'usedPercent' },
  'x-codex-secondary-window-minutes': { window: 'secondary', field: 'windowMinutes' },
  'x-codex-secondary-reset-at': { window: 'secondary', field: 'reset', format: 'epoch-seconds' },
}

/** One quota axis under construction from whatever fields arrived. */
interface PartialDimension {
  limit?: number
  remaining?: number
  reset?: number
}

interface PartialWindow {
  usedPercent?: number
  reset?: number
  windowMinutes?: number
}

/** Parse one numeric header value; blank, negative, and non-finite values fail. */
function parseNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

const OPENAI_DURATION = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?$/

/**
 * Parse one reset value into an epoch-millisecond timestamp. OpenAI
 * durations are relative to `now`; Anthropic values are absolute ISO 8601.
 */
function parseResetMs(value: string, format: 'openai-duration' | 'iso-timestamp', now: number): number | undefined {
  if (format === 'iso-timestamp') {
    const parsed = Date.parse(value.trim())
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const match = OPENAI_DURATION.exec(value.trim())
  if (match === null || (match[1] === undefined && match[2] === undefined
    && match[3] === undefined && match[4] === undefined)) {
    return undefined
  }
  // Absent components read as zero; an absurd digit run overflows to
  // Infinity and refuses rather than producing a bogus timestamp.
  // The exec array types absent capture groups as plain strings; only the
  // runtime values can be undefined, so the group list says so explicitly.
  const groups: Array<string | undefined> = match.slice(1)
  const [days = 0, hours = 0, minutes = 0, seconds = 0] = groups.map(part => Number(part ?? 0))
  const duration = ((days * 24 + hours) * 60 + minutes) * 60_000 + seconds * 1_000
  if (!Number.isFinite(duration)) return undefined
  return now + duration
}

/** Parse an epoch-seconds header into an epoch-millisecond timestamp. */
function parseEpochSeconds(value: string): number | undefined {
  const seconds = parseNumber(value)
  if (seconds === undefined || !Number.isFinite(seconds * 1_000)) return undefined
  return seconds * 1_000
}

/**
 * Derive a readable Codex window label from its documented duration header.
 * @param value - the window-minutes header, if present.
 * @param fallback - the stable label used when the header is absent or invalid.
 * @returns a compact duration label or the fallback label.
 */
function codexWindowLabel(value: number | undefined, fallback: 'primary' | 'secondary'): string {
  if (value === undefined || !Number.isInteger(value) || value <= 0) return fallback
  if (value % 1_440 === 0) return `${value / 1_440}d`
  if (value % 60 === 0) return `${value / 60}h`
  return `${value}m`
}

/**
 * Normalize one completed response's headers into provider-status input.
 * @param subscription - whether the request authenticated with a stored subscription token.
 * @param headers - response headers exactly as received; lookup is case-insensitive.
 * @param now - epoch milliseconds of the observation, used to turn relative resets into timestamps.
 * @returns snapshot dimensions and plan windows, an unavailable state when recognized fields
 * existed but none parsed usefully, or undefined when nothing recognizable was sent.
 */
export function normalizeRateLimitHeaders(
  subscription: boolean,
  headers: Readonly<Record<string, string>>,
  now: number,
): NormalizedRateLimit | undefined {
  // Subscription headers use a separate allowlist but share the counter parser.
  void subscription
  const partials = new Map<ProviderQuotaDimension, PartialDimension>()
  const windows = new Map<PlanWindowBinding['window'], PartialWindow>()
  let sawRecognized = false
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase()
    const binding = BINDINGS[key]
    const windowBinding = WINDOW_BINDINGS[key]
    if (binding === undefined && windowBinding === undefined) continue
    sawRecognized = true
    if (binding !== undefined) {
      let partial = partials.get(binding.dimension)
      if (partial === undefined) {
        partial = {}
        partials.set(binding.dimension, partial)
      }
      if (binding.field === 'reset') {
        const reset = parseResetMs(value, binding.format, now)
        if (reset !== undefined) partial.reset = reset
      } else if (binding.field === 'remaining') {
        const remaining = parseNumber(value)
        if (remaining !== undefined) partial.remaining = remaining
      } else {
        const limit = parseNumber(value)
        if (limit !== undefined && limit > 0) partial.limit = limit
      }
      continue
    }
    if (windowBinding === undefined) continue
    let partial = windows.get(windowBinding.window)
    if (partial === undefined) {
      partial = {}
      windows.set(windowBinding.window, partial)
    }
    if (windowBinding.field === 'usedPercent') {
      const parsed = parseNumber(value)
      const usedPercent = windowBinding.format === 'fraction' ? (parsed === undefined ? undefined : parsed * 100) : parsed
      if (usedPercent !== undefined && usedPercent <= 100) partial.usedPercent = usedPercent
    } else if (windowBinding.field === 'reset') {
      const reset = parseEpochSeconds(value)
      if (reset !== undefined) partial.reset = reset
    } else {
      const minutes = parseNumber(value)
      if (minutes !== undefined) partial.windowMinutes = minutes
    }
  }
  if (!sawRecognized) return undefined
  const dimensions: ProviderQuotaDimensionSnapshot[] = []
  for (const [dimension, partial] of partials) {
    // A dimension publishes only as a complete usable pair; a limit without a
    // remaining figure cannot yield a percentage and is never zero-filled.
    if (partial.limit === undefined || partial.remaining === undefined) continue
    dimensions.push({
      dimension,
      limit: partial.limit,
      remaining: partial.remaining,
      ...partial.reset === undefined ? {} : { reset: partial.reset },
    })
  }
  const planWindows: ProviderPlanWindowSnapshot[] = []
  for (const [window, partial] of windows) {
    if (partial.usedPercent === undefined) continue
    const label = window === '5h' || window === '7d' ? window : codexWindowLabel(partial.windowMinutes, window)
    planWindows.push({
      window: label,
      usedPercent: partial.usedPercent,
      ...partial.reset === undefined ? {} : { reset: partial.reset },
    })
  }
  if (dimensions.length === 0 && planWindows.length === 0) {
    return {
      kind: 'unavailable',
      reason: 'rate-limit headers were present but carried no parseable values',
    }
  }
  return { kind: 'snapshot', dimensions, windows: planWindows }
}
