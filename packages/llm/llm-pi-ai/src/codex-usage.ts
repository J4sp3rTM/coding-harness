/**
 * Codex OAuth usage endpoint → provider-status plan windows.
 *
 * Codex OAuth exposes subscription windows through a JSON usage endpoint, so
 * reading `/usage` does not need to start an inference stream or send a model
 * prompt. This module owns the endpoint request and validates its untrusted
 * JSON before publication.
 *
 * @module dsh-llm-pi-ai/codex-usage
 */

import type { ProviderPlanWindowSnapshot } from '@deepseek-ai/dsh-provider-status'

/** Codex OAuth endpoint that reports the current plan windows. */
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

/** Parsed Codex plan windows ready for provider-status publication. */
export interface CodexUsageSnapshot {
  /** Subscription windows in the endpoint's primary/secondary order. */
  windows: ProviderPlanWindowSnapshot[]
}

/** A numeric value accepted from the Codex JSON response. */
function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** A plain object from an untrusted JSON value. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Label a Codex window from its documented duration, with a stable fallback. */
function windowLabel(seconds: number, fallback: 'primary' | 'secondary'): string {
  if (seconds === 18_000) return '5h'
  if (seconds === 604_800) return '7d'
  return fallback
}

/** Parse one Codex rate-limit window, or ignore an unusable window. */
function parseWindow(value: unknown, fallback: 'primary' | 'secondary'): ProviderPlanWindowSnapshot | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const usedPercent = finiteNumber(record.used_percent)
  const duration = finiteNumber(record.limit_window_seconds)
  if (
    usedPercent === undefined || usedPercent < 0 || usedPercent > 100
    || duration === undefined || !Number.isSafeInteger(duration) || duration <= 0
  ) return undefined
  const resetSeconds = finiteNumber(record.reset_at)
  const reset = resetSeconds === undefined || resetSeconds < 0 || !Number.isFinite(resetSeconds * 1_000)
    ? undefined
    : resetSeconds * 1_000
  return {
    window: windowLabel(duration, fallback),
    usedPercent,
    ...reset === undefined ? {} : { reset },
  }
}

/**
 * Parse one Codex usage JSON body into provider-status plan windows.
 * @param input - decoded JSON returned by {@link CODEX_USAGE_URL}.
 * @returns usable windows, or undefined when no usable window is present.
 */
export function parseCodexUsage(input: unknown): CodexUsageSnapshot | undefined {
  const root = recordOf(input)
  const rateLimit = recordOf(root?.rate_limit)
  if (rateLimit === undefined) return undefined
  const windows = [
    parseWindow(rateLimit.primary_window, 'primary'),
    parseWindow(rateLimit.secondary_window, 'secondary'),
  ].filter((window): window is ProviderPlanWindowSnapshot => window !== undefined)
  return windows.length === 0 ? undefined : { windows }
}

/**
 * GET the Codex OAuth usage endpoint and parse its plan windows.
 * @param access - stored Codex OAuth access token.
 * @param signal - cancellation owned by the invoking command.
 * @param accountId - optional ChatGPT account id for team/workspace tokens.
 * @param fetchImpl - injectable fetch for tests; defaults to global fetch.
 * @returns parsed windows, or undefined when the endpoint refuses or the body is unusable.
 */
export async function harvestCodexUsage(
  access: string,
  signal: AbortSignal,
  accountId?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CodexUsageSnapshot | undefined> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${access}`,
    accept: 'application/json',
    'user-agent': 'codex-cli',
  }
  if (accountId !== undefined && accountId.length > 0) headers['chatgpt-account-id'] = accountId
  const response = await fetchImpl(CODEX_USAGE_URL, { method: 'GET', signal, headers })
  if (!response.ok) return undefined
  try {
    return parseCodexUsage(await response.json())
  } catch (_malformedBody) {
    return undefined
  }
}
