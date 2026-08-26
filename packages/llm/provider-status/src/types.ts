/**
 * Published record types for the provider-status service. Types only: every
 * runtime behavior lives beside the service in `index.ts`.
 * @module @deepseek-ai/dsh-provider-status/types
 */

/** One measurable quota axis a provider may report against its own limits. */
export type ProviderQuotaDimension = 'requests' | 'tokens' | 'inputTokens' | 'outputTokens'

/** One dimension's last-reported limit/remaining pair, with an optional reset time. */
export interface ProviderQuotaDimensionSnapshot {
  /** The measured quota axis. */
  dimension: ProviderQuotaDimension
  /** The provider-reported ceiling for this window; a positive finite number. */
  limit: number
  /** The provider-reported remaining allowance; a finite non-negative number. */
  remaining: number
  /**
   * Epoch milliseconds when the provider window resets, when the provider
   * documents and sends a parseable value. Absent means "unknown", never zero.
   */
  reset?: number
}

/**
 * Consumption of one subscription allowance window, distinct from a rate-limit
 * counter dimension; the two measurements must not be mixed or summed.
 */
export interface ProviderPlanWindowSnapshot {
  /** Non-empty provider window label, such as `5h` or `7d`. */
  window: string
  /** Percentage of the subscription allowance consumed, from 0 through 100. */
  usedPercent: number
  /** Epoch milliseconds when the subscription window resets, when provided. */
  reset?: number
}

/** The last quota observation for one route, as parsed from response headers. */
export interface ProviderStatusSnapshot {
  /** Harness provider route the observation belongs to. */
  routeId: string
  /** Rate-limit counter dimensions; distinct from subscription plan windows. */
  dimensions: readonly ProviderQuotaDimensionSnapshot[]
  /** Subscription allowance windows; distinct from rate-limit counter dimensions. */
  windows: readonly ProviderPlanWindowSnapshot[]
  /** Epoch milliseconds when the service committed this snapshot. */
  observedAt: number
  /** Where the observation came from. Only response-header parsing exists today. */
  source: 'response-headers'
}

/**
 * A provider statement that no usable status could be derived. Recorded when
 * a response carries recognized rate-limit fields whose values are all
 * unusable, so consumers can distinguish "provider spoke, nothing parseable"
 * from "no observation yet".
 */
export interface ProviderStatusUnavailable {
  /** Harness provider route the observation belongs to. */
  routeId: string
  /** Epoch milliseconds when the service committed this state. */
  observedAt: number
  /** Why the response yielded no usable dimensions; never quotes credential material. */
  reason: string
}

/** What `lookup` answers: the latest observation for one route, of either kind. */
export type ProviderStatusRecord =
  | ({ kind: 'snapshot' } & ProviderStatusSnapshot)
  | ({ kind: 'unavailable' } & ProviderStatusUnavailable)

/**
 * The opaque non-secret identity of the credential/configuration a snapshot
 * was observed under — a credential reference name or equivalent label, never
 * key material. Records carry it so diagnostics can tell two configurations
 * of one route apart.
 */
export interface ProviderStatusPublication {
  /** Harness provider route the observation belongs to. */
  routeId: string
  /** Non-secret credential/configuration label, when the caller knows one. */
  credentialIdentity?: string
}
