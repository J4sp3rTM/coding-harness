/**
 * Ephemeral, host-process store of the last provider status observation per
 * route: quota dimensions parsed from a provider response's rate-limit
 * headers, or an explicit unavailable state. The service is an in-memory
 * write/read rendezvous between adapter-side observers and consumers such as
 * `/usage`; nothing is persisted, and disposal of the owning fiber drops all
 * state with it.
 *
 * Snapshots describe the credential that produced them: `remaining` is the
 * provider's own allowance figure for the observed window, not account usage
 * and not a billing figure. Publications are validated here — finite
 * non-negative numbers, known dimensions, one entry per dimension — so every
 * reader can trust the stored values without re-parsing.
 *
 * @module @deepseek-ai/dsh-provider-status
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ProviderStatusPublication, ProviderStatusRecord } from './types.ts'
import type {
  ProviderPlanWindowSnapshot,
  ProviderQuotaDimension,
  ProviderQuotaDimensionSnapshot,
} from './types.ts'

export type * from './types.ts'

/** Service configuration; this store takes no settings. */
export interface ProviderStatusConfig {}

/** Every dimension name a snapshot may carry. */
export const PROVIDER_QUOTA_DIMENSIONS: readonly ProviderQuotaDimension[] = [
  'requests',
  'tokens',
  'inputTokens',
  'outputTokens',
]

/** Reject a config carrying keys this service does not own. */
function validateConfigKeys(config: ProviderStatusConfig): void {
  for (const key of Object.keys(config)) {
    throw new Error(`provider-status: unknown config key "${key}" (no settings are supported)`)
  }
}

/** Validate the publication fields shared by both record kinds. */
function validatePublication(publication: ProviderStatusPublication): void {
  if (typeof publication.routeId !== 'string' || publication.routeId.length === 0) {
    throw new Error('provider-status: routeId must be a non-empty string')
  }
  if (publication.credentialIdentity !== undefined
    && (typeof publication.credentialIdentity !== 'string' || publication.credentialIdentity.length === 0)) {
    throw new Error('provider-status: credentialIdentity must be a non-empty string when present')
  }
}

/** Validate one dimension entry and reject duplicates within one publication. */
function validateDimension(
  dimension: ProviderQuotaDimensionSnapshot,
  seen: Set<ProviderQuotaDimension>,
): void {
  if (!PROVIDER_QUOTA_DIMENSIONS.includes(dimension.dimension)) {
    throw new Error(`provider-status: unknown quota dimension ${JSON.stringify(dimension.dimension)}`)
  }
  if (!Number.isFinite(dimension.limit) || dimension.limit <= 0) {
    throw new Error(`provider-status: dimension "${dimension.dimension}" limit must be a positive finite number`)
  }
  if (!Number.isFinite(dimension.remaining) || dimension.remaining < 0) {
    throw new Error(`provider-status: dimension "${dimension.dimension}" remaining must be a finite non-negative number`)
  }
  if (dimension.reset !== undefined && (!Number.isFinite(dimension.reset) || dimension.reset < 0)) {
    throw new Error(`provider-status: dimension "${dimension.dimension}" reset must be a finite non-negative epoch-ms number when present`)
  }
  if (seen.has(dimension.dimension)) {
    throw new Error(`provider-status: dimension "${dimension.dimension}" is published more than once`)
  }
  seen.add(dimension.dimension)
}

/** Validate one subscription allowance window and reject duplicate labels. */
function validatePlanWindow(
  window: ProviderPlanWindowSnapshot,
  seen: Set<string>,
): void {
  if (typeof window.window !== 'string' || window.window.length === 0) {
    throw new Error('provider-status: plan window label must be a non-empty string')
  }
  if (!Number.isFinite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100) {
    throw new Error(`provider-status: plan window "${window.window}" usedPercent must be a finite number from 0 through 100`)
  }
  if (window.reset !== undefined && (!Number.isFinite(window.reset) || window.reset < 0)) {
    throw new Error(`provider-status: plan window "${window.window}" reset must be a finite non-negative epoch-ms number when present`)
  }
  if (seen.has(window.window)) {
    throw new Error(`provider-status: plan window "${window.window}" is published more than once`)
  }
  seen.add(window.window)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    providerStatus: ProviderStatus
  }
}

/**
 * Host-process store of the last status observation per route. One record per
 * route at a time: each publication replaces the previous one, so `lookup`
 * always answers with the freshest observation regardless of which
 * configuration produced it. Records are frozen detached copies.
 */
export class ProviderStatus extends Service {
  // Schemastery preserves untrusted loader keys on an empty object schema;
  // the public type excludes settings while validateConfigKeys rejects them.
  static Config: z<ProviderStatusConfig> = z.object({})

  private readonly records = new Map<string, ProviderStatusRecord>()

  constructor(ctx: Context, config: ProviderStatusConfig = {}) {
    super(ctx, 'providerStatus')
    validateConfigKeys(config)
  }

  /**
   * Commit one quota snapshot as the latest observation for its route.
   * Dimensions and plan windows are validated before anything is stored; a
   * rejected publication leaves the previously stored record serving.
   * @param publication - the route, optional non-secret credential identity, and parsed quota measurements.
   * @throws when any field is outside its documented domain.
   */
  recordSnapshot(publication: ProviderStatusPublication & {
    /** Fully parsed dimensions; each named once. */
    dimensions?: readonly ProviderQuotaDimensionSnapshot[]
    /** Subscription allowance windows; each labeled once. */
    windows?: readonly ProviderPlanWindowSnapshot[]
  }): void {
    validatePublication(publication)
    const dimensions = publication.dimensions ?? []
    const windows = publication.windows ?? []
    if (dimensions.length === 0 && windows.length === 0) {
      throw new Error('provider-status: a snapshot needs at least one quota dimension or plan window')
    }
    const seenDimensions = new Set<ProviderQuotaDimension>()
    for (const dimension of dimensions) validateDimension(dimension, seenDimensions)
    const seenWindows = new Set<string>()
    for (const window of windows) validatePlanWindow(window, seenWindows)
    const record: ProviderStatusRecord = {
      kind: 'snapshot',
      routeId: publication.routeId,
      observedAt: Date.now(),
      source: 'response-headers',
      dimensions: Object.freeze(dimensions.map(dimension => Object.freeze({ ...dimension }))),
      windows: Object.freeze(windows.map(window => Object.freeze({ ...window }))),
      ...publication.credentialIdentity === undefined ? {} : { credentialIdentity: publication.credentialIdentity },
    }
    this.records.set(publication.routeId, Object.freeze(record))
  }

  /**
   * Commit an explicit unavailable state as the latest observation for its
   * route. Use this when a response carried recognized status fields whose
   * values were all unusable; a response with no recognizable fields is
   * simply not published.
   * @param publication - the route, optional non-secret credential identity, and why nothing usable was parsed.
   * @throws when any field is outside its documented domain.
   */
  recordUnavailable(publication: ProviderStatusPublication & {
    /** Why no usable dimensions could be parsed; never quotes credential material. */
    reason: string
  }): void {
    validatePublication(publication)
    if (typeof publication.reason !== 'string' || publication.reason.length === 0) {
      throw new Error('provider-status: reason must be a non-empty string')
    }
    const record: ProviderStatusRecord = {
      kind: 'unavailable',
      routeId: publication.routeId,
      observedAt: Date.now(),
      reason: publication.reason,
      ...publication.credentialIdentity === undefined ? {} : { credentialIdentity: publication.credentialIdentity },
    }
    this.records.set(publication.routeId, Object.freeze(record))
  }

  /**
   * Read the latest observation for one route.
   * @param routeId - harness provider route to look up.
   * @returns the frozen latest record, or `undefined` before the first publication.
   */
  lookup(routeId: string): ProviderStatusRecord | undefined {
    return this.records.get(routeId)
  }
}

export default ProviderStatus
