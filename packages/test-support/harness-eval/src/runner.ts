/** Generic deterministic A/B evaluation runner with an executor seam. */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { FIXTURES } from './fixtures.ts'
import { classifyProcessCompletion, runValidationCommand } from './process.ts'
import { writeComparisonReports } from './report.ts'
import {
  COMPARISON_SCHEMA_VERSION,
  type AbComparison,
  type AbRunArtifact,
  type AbVariant,
  type AdjudicationArtifact,
  type ExecutionMode,
  type ExecutorEvidence,
  type ExecutorMetadata,
  type ExecutorTiming,
  type FixtureSpec,
  type NormalizedCost,
  type NormalizedUsage,
  type ProcessCompletion,
  type RoutingArtifact,
  type ReviewerArtifact,
  type ValidationResult,
  type WorkerArtifact,
} from './types.ts'

/** Optional metadata supplied by a real executor. */
export interface EvalExecutorResult {
  /** Adapter identity for this run (useful when A/B sides use different tools). */
  executor?: 'codex' | 'deepseek-harness'
  executorOutcome?: 'completed' | 'failed' | 'skipped' | 'inconclusive' | null
  executorTiming?: ExecutorTiming | null
  parentProvider?: string | null
  parentModel?: string | null
  parentEffort?: string | null
  parentEffortSource?: 'configured' | 'provider-default' | null
  parentEffectiveEffort?: string | null
  workers?: WorkerArtifact[]
  agentCalls?: number | null
  usage?: Partial<NormalizedUsage> | null
  cost?: Partial<NormalizedCost> | null
  filesChanged?: string[]
  process?: ProcessCompletion
  reviewFindings?: string[]
  parentCorrections?: string[]
  diffCorrect?: boolean | null
  regression?: string | null
  skipped?: { reason: string }
  executorEvidence?: ExecutorEvidence | null
  /** Fingerprint of the model-facing prompt inputs this run executed under. */
  promptFingerprint?: string | null
}

/** Context passed to a caller-owned executor for one fixture variant. */
export interface EvalExecutorInput {
  fixture: FixtureSpec
  variant: AbVariant
  repetition: number
  sequence: number
  workdir: string
}

/** Runs one variant; the executor may mutate the workspace before validation. */
export type EvalExecutor = (input: EvalExecutorInput) => Promise<EvalExecutorResult | void>

/** Evidence passed to a blind post-run reviewer. */
export interface EvalReviewerInput {
  task: string
  workdir: string
  sequence: number
  validation: ValidationResult
}

/** Structured outputs from independent reviewers. */
export interface EvalReviewerResult {
  reviews: ReviewerArtifact[]
  adjudication: AdjudicationArtifact
}

/** Reviews one completed candidate without receiving its A/B identity. */
export type EvalReviewer = (input: EvalReviewerInput) => Promise<EvalReviewerResult>

/** One observable phase of an A/B run. */
export interface AbEvalProgress {
  phase: 'run-started' | 'workspace-ready' | 'executor-started' | 'executor-completed' | 'validation-started' | 'review-started' | 'review-completed' | 'run-completed'
  sequence: number
  totalRuns: number
  repetition: number
  fixtureId: FixtureSpec['id']
  suite: FixtureSpec['suite']
  variant: AbVariant
  executorOutcome: EvalExecutorResult['executorOutcome'] | null
  validationStatus: ValidationResult['status'] | null
  elapsedMs: number
}

/** Converts optional provider measurements into a stable nullable artifact. */
function normalizeUsage(value: Partial<NormalizedUsage> | null | undefined): NormalizedUsage | null {
  if (value === undefined || value === null) return null
  return {
    inputTokens: value.inputTokens ?? null,
    outputTokens: value.outputTokens ?? null,
    cacheReadTokens: value.cacheReadTokens ?? null,
    cacheWriteTokens: value.cacheWriteTokens ?? null,
    reasoningTokens: value.reasoningTokens ?? null,
  }
}

/** Converts optional provider cost into stable nullable fields. */
function normalizeCost(value: Partial<NormalizedCost> | null | undefined): NormalizedCost | null {
  if (value === undefined || value === null) return null
  return { amount: value.amount ?? null, currency: value.currency ?? null }
}

/** Default routing record when a policy-specific consumer supplies no resolver. */
function noRouting(variant: AbVariant): RoutingArtifact {
  return {
    delegated: variant === 'B',
    shippedTiers: [],
    legacyTiers: [],
    notes: ['No routing policy was supplied; the executor owns Variant B delegation.'],
  }
}

/** Options for {@link runAbEval}. */
export interface AbEvalOptions {
  outDir: string
  repetitions?: number
  applyOracle?: boolean
  timeoutMs?: number
  /** Maximum isolated runs executed at once; defaults to one. */
  concurrency?: number
  fixtures?: readonly FixtureSpec[]
  executor?: EvalExecutor
  executorMetadata?: ExecutorMetadata
  reviewer?: EvalReviewer
  routing?: (fixture: FixtureSpec, variant: AbVariant) => RoutingArtifact
  /**
   * Continue an interrupted evaluation by reusing completed runs recorded in
   * the output directory's `comparison.partial.json`. The saved plan must
   * match the requested plan; anything else fails loudly.
   */
  resume?: boolean
  /**
   * With `resume`, reuse only recorded runs whose validation passed and
   * re-execute every other sequence — for provider outages that failed a
   * batch without reflecting the product under test.
   */
  redoFailed?: boolean
  /** Receives synchronous phase updates without changing artifact output. */
  onProgress?: (progress: AbEvalProgress) => void
}

function qualityScore(validation: ValidationResult, reviews: readonly ReviewerArtifact[]): number | null {
  const correctness = reviews.find(review => review.role === 'correctness' && review.status === 'completed')?.dimensions
  const architecture = reviews.find(review => review.role === 'architecture' && review.status === 'completed')?.dimensions
  if (correctness === undefined || correctness === null || architecture === undefined || architecture === null) return null
  const score = (validation.status === 'passed' ? 50 : 0)
    + architecture.architecture * 4
    + correctness.robustness * 3
    + architecture.maintainability * 2
    + ((correctness.efficiency + architecture.efficiency) / 2)
  return Math.round(score * 10) / 10
}

function validationFiles(fixture: FixtureSpec): readonly string[] {
  return fixture.validation.files ?? ['test.js']
}

function validationPath(root: string, file: string): string {
  if (isAbsolute(file)) throw new Error('harness-eval: validation files must be relative')
  const path = resolve(root, file)
  const scoped = relative(root, path)
  if (scoped === '' || scoped.startsWith('..') || isAbsolute(scoped)) throw new Error(`harness-eval: validation file escapes workspace: ${file}`)
  return path
}

async function resetWorkspace(fixture: FixtureSpec, workdir: string, applyOracle: boolean): Promise<void> {
  await rm(workdir, { recursive: true, force: true })
  await cp(join(fixture.root, 'seed'), workdir, { recursive: true })
  if (applyOracle) await cp(join(fixture.root, 'oracle'), workdir, { recursive: true })
  for (const file of validationFiles(fixture)) await rm(validationPath(workdir, file), { force: true })
  await writeFile(join(workdir, 'package.json'), '{"private":true,"type":"commonjs"}\n')
}

async function materializeValidation(fixture: FixtureSpec, workdir: string): Promise<void> {
  for (const file of validationFiles(fixture)) {
    const destination = validationPath(workdir, file)
    await mkdir(dirname(destination), { recursive: true })
    await cp(validationPath(join(fixture.root, 'seed'), file), destination)
  }
}

/** Loose on-disk shape of a partial comparison artifact used for resume. */
interface PartialComparisonFile {
  schemaVersion?: unknown
  execution?: unknown
  repetitions?: unknown
  executor?: ExecutorMetadata | null
  runs?: Array<Partial<AbRunArtifact>>
}

/** Recovers the scheduled sequence of an artifact, falling back to its recorded stdout path. */
function artifactSequence(artifact: Partial<AbRunArtifact>): number | null {
  if (typeof artifact.sequence === 'number' && Number.isSafeInteger(artifact.sequence) && artifact.sequence > 0) return artifact.sequence
  const match = /^run-(\d+)\.stdout\.txt$/.exec(artifact.validation?.stdoutPath ?? '')
  return match === null ? null : Number(match[1])
}

/**
 * Load completed runs from a previous interrupted evaluation in the same
 * output directory. Every reused run must match the requested plan — fixture,
 * variant, repetition count, and execution mode; mismatches fail loudly
 * because resuming against a different plan would silently mix incompatible
 * measurements.
 */
async function loadResumableRuns(
  outDir: string,
  scheduled: Array<{ fixture: FixtureSpec; variant: AbVariant }>,
  runsPerRepetition: number,
  repetitions: number,
  execution: ExecutionMode,
  executorMetadata: ExecutorMetadata | undefined,
): Promise<AbRunArtifact[]> {
  const path = join(outDir, 'comparison.partial.json')
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
  const partial = JSON.parse(raw) as PartialComparisonFile
  if (partial.schemaVersion !== COMPARISON_SCHEMA_VERSION) {
    throw new Error(`harness-eval: cannot resume comparison with schema version ${String(partial.schemaVersion)}`)
  }
  if (partial.execution !== execution) {
    throw new Error(`harness-eval: cannot resume ${String(partial.execution)} evaluation as ${execution}`)
  }
  if (partial.repetitions !== repetitions) {
    throw new Error(`harness-eval: cannot resume evaluation with ${String(partial.repetitions)} repetitions as ${repetitions}`)
  }
  const savedExecutor = partial.executor ?? null
  const savedExecutorId = savedExecutor?.id ?? null
  const savedExecutorVersion = savedExecutor?.version ?? null
  if (savedExecutorId !== (executorMetadata?.id ?? null) || savedExecutorVersion !== (executorMetadata?.version ?? null)) {
    throw new Error('harness-eval: cannot resume evaluation recorded by a different executor metadata')
  }
  const reused = new Map<number, AbRunArtifact>()
  for (const artifact of partial.runs ?? []) {
    const sequence = artifactSequence(artifact)
    const slot = sequence === null ? undefined : scheduled[sequence - 1]
    if (sequence === null || slot === undefined) {
      throw new Error(`harness-eval: partial run at ${JSON.stringify(artifact.validation?.stdoutPath ?? null)} does not match the requested evaluation plan`)
    }
    if (artifact.fixtureId !== slot.fixture.id || artifact.variant !== slot.variant || artifact.execution !== execution) {
      throw new Error(`harness-eval: partial run ${sequence} (${String(artifact.fixtureId)}/${String(artifact.variant)}) does not match the requested evaluation plan`)
    }
    const repetition = Math.floor((sequence - 1) / runsPerRepetition)
    if (!Number.isSafeInteger(repetition) || repetition < 0 || repetition >= repetitions) {
      throw new Error(`harness-eval: partial run ${sequence} exceeds the requested repetition plan`)
    }
    if (reused.has(sequence)) throw new Error(`harness-eval: partial comparison records run ${sequence} twice`)
    reused.set(sequence, { ...(artifact as AbRunArtifact), sequence })
  }
  return [...reused.values()].sort((left, right) => left.sequence - right.sequence)
}

/**
 * Run every fixture as Parent-only (A) and delegated (B), optionally handing
 * workspace execution to a caller-owned executor. The default remains keyless.
 * @param options - output, fixture, executor, and validation settings.
 * @returns the versioned comparison object also written to comparison.json.
 */
export async function runAbEval(options: AbEvalOptions): Promise<AbComparison> {
  const outDir = resolve(options.outDir)
  const repetitions = options.repetitions ?? 1
  const timeoutMs = options.timeoutMs ?? 10_000
  const concurrency = options.concurrency ?? 1
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new TypeError('harness-eval: concurrency must be a positive integer')
  const fixtures = options.fixtures ?? FIXTURES.filter(fixture => fixture.suite === 'baseline')
  const hasExecutor = options.executor !== undefined
  const applyOracle = options.applyOracle === true && !hasExecutor
  const execution: ExecutionMode = hasExecutor ? 'injected-executor' : applyOracle ? 'keyless-oracle' : 'keyless-seed'
  await mkdir(outDir, { recursive: true })
  const runs: AbRunArtifact[] = []
  let reportWrite: Promise<void> = Promise.resolve()
  const totalRuns = repetitions * fixtures.length * 2
  let sequence = 0
  const scheduled: Array<{ fixture: FixtureSpec; variant: AbVariant; repetition: number; sequence: number }> = []
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const fixture of fixtures) {
      for (const variant of ['A', 'B'] as const) {
        sequence += 1
        scheduled.push({ fixture, variant, repetition, sequence })
      }
    }
  }
  if (options.resume === true) {
    const resumable = await loadResumableRuns(outDir, scheduled, fixtures.length * 2, repetitions, execution, options.executorMetadata)
    for (const artifact of resumable) {
      if (options.redoFailed === true && artifact.validation.status !== 'passed') continue
      runs[artifact.sequence - 1] = artifact
    }
  }
  const runOne = async (scheduledRun: typeof scheduled[number]): Promise<void> => {
    const { fixture, variant, repetition, sequence: runSequence } = scheduledRun
    const workdir = join(outDir, `work-${runSequence}-${variant}-${fixture.id}`)
    const startedAt = new Date()
    const progress = (
      phase: AbEvalProgress['phase'],
      executorOutcome: AbEvalProgress['executorOutcome'] = null,
      validationStatus: AbEvalProgress['validationStatus'] = null,
    ): void => options.onProgress?.({
      phase,
      sequence: runSequence,
      totalRuns,
      repetition: repetition + 1,
      fixtureId: fixture.id,
      suite: fixture.suite,
      variant,
      executorOutcome,
      validationStatus,
      elapsedMs: Date.now() - startedAt.getTime(),
    })
    const reused = runs[runSequence - 1]
    if (reused !== undefined) {
      progress('run-completed', reused.executorOutcome, reused.validation.status)
      return
    }
    progress('run-started')
    await resetWorkspace(fixture, workdir, applyOracle)
    progress('workspace-ready')
    if (hasExecutor) progress('executor-started')
    const executorResult = await options.executor?.({ fixture, variant, repetition, sequence: runSequence, workdir })
    if (hasExecutor) progress('executor-completed', executorResult?.executorOutcome ?? null)
    const executorProcess = executorResult?.process === undefined
      ? null
      : { ...executorResult.process, ...classifyProcessCompletion(executorResult.process) }
    let graded: ValidationResult
    if (executorResult?.skipped !== undefined) {
      graded = {
        exitCode: null,
        timedOut: false,
        cancelled: false,
        signal: null,
        status: 'inconclusive',
        reason: `executor skipped this run: ${executorResult.skipped.reason}`,
        stdout: '',
        stderr: '',
      }
    } else {
      progress('validation-started')
      await materializeValidation(fixture, workdir)
      graded = await runValidationCommand({ ...fixture.validation, cwd: workdir, timeoutMs })
    }
    let reviews: ReviewerArtifact[] = []
    let adjudication: AdjudicationArtifact | null = null
    if (options.reviewer !== undefined && executorResult?.skipped === undefined) {
      progress('review-started', executorResult?.executorOutcome ?? null, graded.status)
      const reviewResult = await options.reviewer({ task: fixture.task, workdir, sequence: runSequence, validation: graded })
      reviews = reviewResult.reviews
      adjudication = reviewResult.adjudication
      const reviewDir = join(outDir, 'review')
      await mkdir(reviewDir, { recursive: true })
      await Promise.all([
        ...reviews.map(review => writeFile(join(reviewDir, `run-${runSequence}-${review.role}.json`), `${JSON.stringify(review, null, 2)}\n`)),
        writeFile(join(reviewDir, `run-${runSequence}-adjudication.json`), `${JSON.stringify(adjudication, null, 2)}\n`),
      ])
      progress('review-completed', executorResult?.executorOutcome ?? null, graded.status)
    }
    const endedAt = new Date()
    const stdoutPath = `run-${runSequence}.stdout.txt`
    const stderrPath = `run-${runSequence}.stderr.txt`
    await writeFile(join(outDir, stdoutPath), graded.stdout)
    await writeFile(join(outDir, stderrPath), graded.stderr)
    const diffCorrect = executorResult?.diffCorrect
          ?? (applyOracle && graded.status === 'passed' ? true : applyOracle && graded.status === 'failed' ? false : null)
    runs[runSequence - 1] = {
      sequence: runSequence,
      variant,
      category: fixture.id,
      fixtureId: fixture.id,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      execution,
      executorId: executorResult?.executor ?? null,
      executorOutcome: executorResult?.executorOutcome ?? null,
      executorTiming: executorResult?.executorTiming ?? null,
      parentProvider: executorResult?.parentProvider ?? null,
      parentModel: executorResult?.parentModel ?? null,
      parentEffort: executorResult?.parentEffort ?? null,
      parentEffortSource: executorResult?.parentEffortSource ?? null,
      parentEffectiveEffort: executorResult?.parentEffectiveEffort ?? null,
      workers: executorResult?.workers ?? [],
      agentCalls: executorResult?.agentCalls ?? (variant === 'A' && !hasExecutor ? 0 : null),
      workUnits: fixture.units.length,
      usage: normalizeUsage(executorResult?.usage),
      cost: normalizeCost(executorResult?.cost),
      filesChanged: executorResult?.filesChanged ?? [],
      executorProcess,
      executorEvidence: executorResult?.executorEvidence ?? null,
      validation: {
        command: [fixture.validation.command, ...fixture.validation.args],
        exitCode: graded.exitCode,
        timedOut: graded.timedOut === true,
        cancelled: graded.cancelled === true,
        signal: graded.signal,
        status: graded.status,
        reason: graded.reason,
        stdoutPath,
        stderrPath,
      },
      skipReason: executorResult?.skipped?.reason ?? null,
      reviewFindings: executorResult?.reviewFindings ?? [],
      parentCorrections: executorResult?.parentCorrections ?? [],
      reviews,
      adjudication,
      qualityScore: qualityScore(graded, reviews),
      promptFingerprint: executorResult?.promptFingerprint ?? null,
      diffCorrect,
      regression: executorResult?.regression ?? null,
      routing: options.routing?.(fixture, variant) ?? noRouting(variant),
    }
    const partialComparison: AbComparison = {
      schemaVersion: COMPARISON_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      execution,
      repetitions,
      executor: options.executorMetadata ?? null,
      runs: runs.filter(Boolean),
    }
    reportWrite = reportWrite.then(() => writeComparisonReports(outDir, partialComparison, true))
    await reportWrite
    progress('run-completed', executorResult?.executorOutcome ?? null, graded.status)
  }
  let nextRun = 0
  const worker = async (): Promise<void> => {
    while (nextRun < scheduled.length) {
      const index = nextRun
      nextRun += 1
      const scheduledRun = scheduled[index]
      if (scheduledRun === undefined) throw new Error('harness-eval: scheduled run disappeared')
      await runOne(scheduledRun)
    }
  }
  const workerResults = await Promise.allSettled(Array.from({ length: Math.min(concurrency, scheduled.length) }, worker))
  const failedWorker = workerResults.find(result => result.status === 'rejected')
  if (failedWorker?.status === 'rejected') throw failedWorker.reason
  const comparison: AbComparison = {
    schemaVersion: COMPARISON_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    execution,
    repetitions,
    executor: options.executorMetadata ?? null,
    runs,
  }
  await reportWrite
  await writeComparisonReports(outDir, comparison, false)
  return comparison
}

export type {
  AbComparison,
  AbRunArtifact,
  AbVariant,
  ExecutionMode,
  FixtureSpec,
  NormalizedCost,
  NormalizedUsage,
  RoutingArtifact,
} from './types.ts'
