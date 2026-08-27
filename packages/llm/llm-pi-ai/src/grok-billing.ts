/**
 * SuperGrok subscription billing → provider-status plan windows.
 *
 * Weekly (and monthly) percent is not on inference headers. The Grok CLI
 * billing endpoint is the documented source Pi and Grok Build use; this
 * module only parses that JSON into the store's plan-window fields.
 *
 * @module dsh-llm-pi-ai/grok-billing
 */

import type { ProviderPlanWindowSnapshot } from '@deepseek-ai/dsh-provider-status'

/** SuperGrok billing endpoint that reports `creditUsagePercent`. */
export const GROK_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'

/** Parsed SuperGrok plan windows ready to publish. */
export interface GrokBillingSnapshot {
  /** One subscription window; label is `7d`, `30d`, or `plan`. */
  windows: ProviderPlanWindowSnapshot[]
}

/**
 * Parse one Grok billing JSON body into a plan-window snapshot.
 * @param input - decoded JSON from {@link GROK_BILLING_URL}.
 * @returns windows when `creditUsagePercent` is a usable number; otherwise undefined.
 */
export function parseGrokBilling(input: unknown): GrokBillingSnapshot | undefined {
  if (input === null || typeof input !== 'object') return undefined
  const config = (input as { config?: unknown }).config
  if (config === null || typeof config !== 'object') return undefined
  const record = config as Record<string, unknown>
  const raw = record.creditUsagePercent ?? record.credit_usage_percent
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return undefined
  const usedPercent = Math.min(100, raw)
  const period = asRecord(record.currentPeriod) ?? asRecord(record.current_period)
  const type = typeof period?.type === 'string' ? period.type : ''
  const window = type.endsWith('WEEKLY') ? '7d' : type.endsWith('MONTHLY') ? '30d' : 'plan'
  const end = period?.end
  const reset = typeof end === 'string' ? Date.parse(end) : Number.NaN
  return {
    windows: [{
      window,
      usedPercent,
      ...Number.isFinite(reset) ? { reset } : {},
    }],
  }
}

/**
 * GET the SuperGrok billing endpoint and parse its plan windows.
 * @param access - stored SuperGrok OAuth access token.
 * @param signal - cancellation owned by the invoking command.
 * @param fetchImpl - injectable fetch for tests; defaults to global fetch.
 * @returns parsed windows, or undefined when the endpoint refuses or the body is unusable.
 */
export async function harvestGrokBilling(
  access: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<GrokBillingSnapshot | undefined> {
  const response = await fetchImpl(GROK_BILLING_URL, {
    method: 'GET',
    signal,
    headers: {
      authorization: `Bearer ${access}`,
      accept: 'application/json',
      'x-grok-client-mode': 'cli',
      'x-grok-client-version': '1.0.4',
    },
  })
  if (!response.ok) return undefined
  try {
    return parseGrokBilling(await response.json())
  } catch (_malformedBody) {
    return undefined
  }
}

/** Narrow one unknown value to a plain object. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}
