/**
 * Development-workflow routing: minimum tier plus whether the parent should
 * start a delegated run at all.
 * @module @deepseek-ai/dsh-tool-development-workflow/route
 */

/** Work-unit role the parent assigns; the model cannot select a tier. */
export type DevelopmentRole = 'implementation' | 'inspection' | 'validation' | 'review'
/** Coarse size/difficulty signal supplied with a work unit. */
export type DevelopmentComplexity = 'simple' | 'ordinary' | 'complex'
/** Integration and review risk supplied with a work unit. */
export type DevelopmentRisk = 'low' | 'medium' | 'high'
/** Deployment model tier selected for a work unit. */
export type DevelopmentTier = 'T1' | 'T2' | 'T3'

/** Model-selected signals that feed {@link routeTier} and {@link shouldDelegate}. */
export interface WorkUnitSignals {
  /** Implementation, inspection, validation, or review. */
  role: DevelopmentRole
  /** Optional complexity; omission is treated as ordinary. */
  complexity?: DevelopmentComplexity
  /** Optional risk; omission is treated as medium. */
  risk?: DevelopmentRisk
  /** True only for architecture, difficult diagnosis, exceptional risk, or high-value final review. */
  exceptional?: boolean
  /** True only when the unit is repetitive or mechanical across multiple similar elements. */
  repetitive?: boolean
  /** Declared file or directory scopes; length is the tiny-change file heuristic. */
  scopes?: string[]
}

/** Deployment knobs for parent-only vs delegated routing. */
export interface RoutingPolicy {
  /**
   * When true (the default), a tiny non-repetitive unit is not delegated.
   * Set false only when a deployment must keep the previous always-delegate behavior.
   */
  refuseTinyNonRepetitive?: boolean
  /** Maximum declared scopes still treated as a tiny 1–2 file change. Default 2. */
  tinyMaxFiles?: number
}

/**
 * Previous T3 rule: any `simple` + `low` unit became T3. Kept so A/B artifacts can
 * compare the shipped policy against that baseline without retuning fixtures.
 * @param unit - the model-selected work-unit signals.
 * @returns the tier that rule would have selected.
 */
export function legacyRouteTier(unit: Pick<WorkUnitSignals, 'role' | 'complexity' | 'risk' | 'exceptional'>): DevelopmentTier {
  if (unit.role === 'review' && unit.exceptional === true) return 'T1'
  if ((unit.complexity ?? 'ordinary') === 'simple' && (unit.risk ?? 'medium') === 'low') return 'T3'
  return 'T2'
}

/**
 * Select the minimum deployment tier for one unit.
 * T1 only when `exceptional` is true. T3 only for simple low-risk work that is
 * also marked repetitive. Everything else is T2. `simple` + `low` alone is not T3.
 * @param unit - the model-selected work-unit signals.
 * @returns the deployment tier selected for the unit.
 */
export function routeTier(unit: WorkUnitSignals): DevelopmentTier {
  if (unit.exceptional === true) return 'T1'
  const complexity = unit.complexity ?? 'ordinary'
  const risk = unit.risk ?? 'medium'
  if (complexity === 'simple' && risk === 'low' && unit.repetitive === true) return 'T3'
  return 'T2'
}

/**
 * Whether one unit is a tiny non-repetitive change that the parent should keep.
 * @param unit - the model-selected work-unit signals.
 * @param tinyMaxFiles - maximum declared scopes still treated as tiny. Default 2.
 * @returns true when the unit is simple, low-risk, not repetitive, not exceptional, and at most `tinyMaxFiles` scopes.
 */
export function isTinyNonRepetitive(unit: WorkUnitSignals, tinyMaxFiles = 2): boolean {
  const complexity = unit.complexity ?? 'ordinary'
  const risk = unit.risk ?? 'medium'
  const fileCount = unit.scopes === undefined || unit.scopes.length === 0 ? 1 : unit.scopes.length
  return complexity === 'simple'
    && risk === 'low'
    && unit.repetitive !== true
    && unit.exceptional !== true
    && fileCount <= tinyMaxFiles
}

/**
 * Whether the parent should start a delegated workflow for this unit list.
 * The default policy refuses a call whose every unit is a tiny non-repetitive change.
 * @param units - resolved work units for one `delegate_work` call.
 * @param policy - optional refusal knobs; defaults refuse tiny non-repetitive work with a 2-file ceiling.
 * @returns false when the parent should complete the work without starting workers.
 */
export function shouldDelegate(units: readonly WorkUnitSignals[], policy: RoutingPolicy = {}): boolean {
  if (units.length === 0) return false
  if (policy.refuseTinyNonRepetitive === false) return true
  const tinyMaxFiles = policy.tinyMaxFiles ?? 2
  return !units.every(unit => isTinyNonRepetitive(unit, tinyMaxFiles))
}
