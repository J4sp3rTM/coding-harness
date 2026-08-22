/** Generic deterministic A/B evaluation runner with an executor seam. */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { FIXTURES } from './fixtures.ts'
import { classifyProcessCompletion, runValidationCommand } from './process.ts'
import {
  COMPARISON_SCHEMA_VERSION,
  type AbComparison,
  type AbRunArtifact,
  type AbVariant,
  type ExecutionMode,
  type ExecutorEvidence,
  type ExecutorMetadata,
  type ExecutorTiming,
  type FixtureSpec,
  type NormalizedCost,
  type NormalizedUsage,
  type ProcessCompletion,
  type RoutingArtifact,
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

/** One observable phase of an A/B run. */
export interface AbEvalProgress {
  phase: 'run-started' | 'workspace-ready' | 'executor-started' | 'executor-completed' | 'validation-started' | 'run-completed'
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
  routing?: (fixture: FixtureSpec, variant: AbVariant) => RoutingArtifact
  /** Receives synchronous phase updates without changing artifact output. */
  onProgress?: (progress: AbEvalProgress) => void
}

async function resetWorkspace(fixture: FixtureSpec, workdir: string, applyOracle: boolean): Promise<void> {
  await rm(workdir, { recursive: true, force: true })
  await cp(join(fixture.root, 'seed'), workdir, { recursive: true })
  if (applyOracle) await cp(join(fixture.root, 'oracle'), workdir, { recursive: true })
  await writeFile(join(workdir, 'package.json'), '{"private":true,"type":"commonjs"}\n')
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
      graded = await runValidationCommand({ ...fixture.validation, cwd: workdir, timeoutMs })
    }
    const endedAt = new Date()
    const stdoutPath = `run-${runSequence}.stdout.txt`
    const stderrPath = `run-${runSequence}.stderr.txt`
    await writeFile(join(outDir, stdoutPath), graded.stdout)
    await writeFile(join(outDir, stderrPath), graded.stderr)
    const diffCorrect = executorResult?.diffCorrect
          ?? (applyOracle && graded.status === 'passed' ? true : applyOracle && graded.status === 'failed' ? false : null)
    runs[runSequence - 1] = {
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
      diffCorrect,
      regression: executorResult?.regression ?? null,
      routing: options.routing?.(fixture, variant) ?? noRouting(variant),
    }
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
  await writeFile(join(outDir, 'comparison.json'), `${JSON.stringify(comparison, null, 2)}\n`)
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
