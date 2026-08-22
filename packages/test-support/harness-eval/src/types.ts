/** Version written into every comparison artifact. */
export const COMPARISON_SCHEMA_VERSION = 1 as const

/** One of the deterministic benchmark categories. */
export type FixtureCategory =
  | 'tiny-localized'
  | 'repetitive-mechanical'
  | 'medium-implementation'
  | 'risky-cross-component'
  | 'config-layering'
  | 'retry-policy'
  | 'event-projection'
  | 'transactional-batch'
  | 'dependency-scheduler'
  | 'session-compaction'
  | 'plugin-lifecycle-stress'
  | 'durable-workflow-recovery'
  | 'multi-tenant-tool-runtime'

/** Cost-selectable benchmark group. */
export type FixtureSuite = 'baseline' | 'medium' | 'difficult' | 'stress'

/** Generic work-unit signals that a policy-specific test may consume. */
export interface EvalWorkUnit {
  role: 'implementation' | 'inspection' | 'validation' | 'review'
  complexity?: 'simple' | 'ordinary' | 'complex'
  risk?: 'low' | 'medium' | 'high'
  exceptional?: boolean
  repetitive?: boolean
  scopes?: string[]
}

/** On-disk fixture and command used for deterministic validation. */
export interface FixtureSpec {
  id: FixtureCategory
  suite: FixtureSuite
  task: string
  root: string
  validation: { command: string; args: string[] }
  units: EvalWorkUnit[]
}

/** A/B side of one fixture run. */
export type AbVariant = 'A' | 'B'

/** How an evaluation workspace was executed. */
export type ExecutionMode = 'keyless-seed' | 'keyless-oracle' | 'injected-executor'

/** Identity and evidence supplied by a caller-owned executor. */
export interface ExecutorMetadata {
  id: string
  version: string | null
  evidence: string[]
}

/** Process facts observed by a validation waiter. */
export interface ProcessCompletion {
  exitCode: number | null | undefined
  timedOut?: boolean
  cancelled?: boolean
  signal?: string | null
  stdout?: string
  stderr?: string
}

/** Validation outcome derived only from process completion facts. */
export interface ValidationClassification {
  status: 'passed' | 'failed' | 'inconclusive'
  reason: string
  stdout: string
  stderr: string
}

/** Process facts together with their completion-based classification. */
export type ValidationResult = ProcessCompletion & ValidationClassification

/** Normalized model-token measurements; unavailable measurements stay null. */
export interface NormalizedUsage {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  reasoningTokens: number | null
}

/** Normalized monetary measurement; unavailable measurements stay null. */
export interface NormalizedCost {
  amount: number | null
  currency: string | null
}

/** Worker metadata recorded by an executor. */
export interface WorkerArtifact {
  provider: string | null
  model: string | null
  effort: string | null
  effortSource: 'configured' | 'provider-default' | null
  effectiveEffort: string | null
}

/** Paths to executor-owned process evidence, when supplied. */
export interface ExecutorEvidence {
  stdoutPath: string | null
  stderrPath: string | null
}

/** Executor-owned timing segments; unavailable product measurements stay null. */
export interface ExecutorTiming {
  totalMs: number
  startupMs: number | null
  agentMs: number | null
  teardownMs: number | null
}

/** Routing facts supplied by a policy-specific consumer. */
export interface RoutingArtifact {
  delegated: boolean
  shippedTiers: string[]
  legacyTiers: string[]
  notes: string[]
}

/** One run in a comparison artifact. */
export interface AbRunArtifact {
  variant: AbVariant
  category: FixtureCategory
  fixtureId: FixtureCategory
  startedAt: string
  endedAt: string
  durationMs: number
  execution: ExecutionMode
  /** Real adapter that executed this variant, when a live executor was used. */
  executorId: 'codex' | 'deepseek-harness' | null
  /** Product-level outcome, independent from process teardown and fixture validation. */
  executorOutcome: 'completed' | 'failed' | 'skipped' | 'inconclusive' | null
  /** Product timing segments, when the adapter can observe them. */
  executorTiming: ExecutorTiming | null
  parentProvider: string | null
  parentModel: string | null
  parentEffort: string | null
  parentEffortSource: 'configured' | 'provider-default' | null
  parentEffectiveEffort: string | null
  workers: WorkerArtifact[]
  agentCalls: number | null
  workUnits: number
  usage: NormalizedUsage | null
  cost: NormalizedCost | null
  filesChanged: string[]
  /** Executor process evidence, classified independently from fixture validation. */
  executorProcess: ValidationResult | null
  executorEvidence: ExecutorEvidence | null
  validation: {
    command: string[]
    exitCode: number | null | undefined
    timedOut: boolean
    cancelled: boolean
    signal: string | null | undefined
    status: ValidationClassification['status']
    reason: string
    stdoutPath: string
    stderrPath: string
  }
  /** Non-null when the executor intentionally skipped this run. */
  skipReason: string | null
  reviewFindings: string[]
  parentCorrections: string[]
  diffCorrect: boolean | null
  regression: string | null
  routing: RoutingArtifact
}

/** Versioned comparison artifact written by the runner. */
export interface AbComparison {
  schemaVersion: typeof COMPARISON_SCHEMA_VERSION
  generatedAt: string
  execution: ExecutionMode
  repetitions: number
  executor: ExecutorMetadata | null
  runs: AbRunArtifact[]
}
