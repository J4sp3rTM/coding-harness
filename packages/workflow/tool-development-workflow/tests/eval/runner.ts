/**
 * Small A/B evaluation runner: identical fixtures for Parent-only (A) vs
 * delegated (B) routing intent, graded by confirmed process completion.
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { legacyRouteTier, routeTier, shouldDelegate } from '../../src/route.ts'
import { FIXTURES, type FixtureSpec } from './fixtures.ts'
import { runValidationCommand } from './process.ts'

/** Which execution variant to record. */
export type AbVariant = 'A' | 'B'

/** How the runner obtained the workspace under test. */
export type ExecutionMode = 'keyless-seed' | 'keyless-oracle' | 'live-skipped' | 'live'

/** One variant run against one fixture. */
export interface AbRunArtifact {
  variant: AbVariant
  category: FixtureSpec['id']
  fixtureId: FixtureSpec['id']
  startedAt: string
  endedAt: string
  durationMs: number
  execution: ExecutionMode
  parentModel: string | null
  workers: Array<{
    provider?: string
    model?: string
    effort?: string
    effortSource?: 'configured' | 'provider-default'
    effectiveEffort?: string
  }>
  agentCalls: number | null
  workUnits: number
  usage: { unavailable: string }
  cost: { unavailable: string }
  filesChanged: string[]
  validation: {
    command: string[]
    exitCode: number | null | undefined
    timedOut: boolean
    cancelled: boolean
    signal: string | null | undefined
    status: 'passed' | 'failed' | 'inconclusive'
    reason: string
    stdoutPath: string
    stderrPath: string
  }
  reviewFindings: string[]
  parentCorrections: string[]
  diffCorrect: boolean | null
  regression: string | null
  routing: {
    delegated: boolean
    shippedTiers: string[]
    legacyTiers: string[]
    notes: string[]
  }
}

/** Comparison file written to the output directory. */
export interface AbComparison {
  generatedAt: string
  execution: ExecutionMode
  repetitions: number
  liveSkipReason: string | null
  runs: AbRunArtifact[]
}

/** Options for {@link runAbEval}. */
export interface AbEvalOptions {
  /** Directory that receives comparison.json and per-run evidence files. */
  outDir: string
  /** How many times to run the full A×B×fixture matrix. Default 1. */
  repetitions?: number
  /** Overlay oracle sources before validation (keyless correctness of fixtures). */
  applyOracle?: boolean
  /** Validation waiter timeout. Default 10_000. */
  timeoutMs?: number
  /** Attempt a live model comparison when a key is present. Default false. */
  live?: boolean
}

async function resetWorkspace(fixture: FixtureSpec, workdir: string, applyOracle: boolean): Promise<void> {
  await rm(workdir, { recursive: true, force: true })
  await cp(join(fixture.root, 'seed'), workdir, { recursive: true })
  if (applyOracle) await cp(join(fixture.root, 'oracle'), workdir, { recursive: true })
}

function routingFor(fixture: FixtureSpec, variant: AbVariant): AbRunArtifact['routing'] {
  const shippedTiers = fixture.units.map(unit => routeTier(unit))
  const legacyTiers = fixture.units.map(unit => legacyRouteTier(unit))
  const wouldDelegate = shouldDelegate(fixture.units)
  if (variant === 'A') {
    return {
      delegated: false,
      shippedTiers,
      legacyTiers,
      notes: ['Variant A is Parent-only: workers are not started.'],
    }
  }
  return {
    delegated: wouldDelegate,
    shippedTiers,
    legacyTiers,
    notes: wouldDelegate
      ? ['Variant B would start a delegated workflow under the shipped routing policy.']
      : ['Variant B would refuse delegation under the shipped policy; the parent keeps the work.'],
  }
}

/**
 * Run the four fixtures for variants A and B, reset between runs, and write
 * structured comparison artifacts. Keyless modes never call a model.
 * @param options - output directory and execution knobs.
 * @returns the comparison object also written to `outDir/comparison.json`.
 */
export async function runAbEval(options: AbEvalOptions): Promise<AbComparison> {
  const repetitions = options.repetitions ?? 1
  const applyOracle = options.applyOracle === true
  const timeoutMs = options.timeoutMs ?? 10_000
  const liveRequested = options.live === true
  const liveKey = process.env.DEEPSEEK_API_KEY
  let execution: ExecutionMode = applyOracle ? 'keyless-oracle' : 'keyless-seed'
  let liveSkipReason: string | null = null
  if (liveRequested) {
    if (liveKey === undefined || liveKey.length === 0) {
      execution = 'live-skipped'
      liveSkipReason = 'DEEPSEEK_API_KEY is unset; live Parent-only vs delegated comparison was not run.'
    } else {
      execution = 'live-skipped'
      liveSkipReason = 'A live API key is present, but this runner does not drive a full parent/worker agent loop; keyless fixture grading plus routing tests remain the accepted comparison.'
    }
  }
  await mkdir(options.outDir, { recursive: true })
  const runs: AbRunArtifact[] = []
  let seq = 0
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const fixture of FIXTURES) {
      for (const variant of ['A', 'B'] as const) {
        seq += 1
        const workdir = join(options.outDir, `work-${seq}-${variant}-${fixture.id}`)
        const startedAt = new Date()
        await resetWorkspace(fixture, workdir, applyOracle && execution !== 'live-skipped')
        const graded = await runValidationCommand({
          command: fixture.validation.command,
          args: fixture.validation.args,
          cwd: workdir,
          timeoutMs,
        })
        const endedAt = new Date()
        const stdoutPath = `run-${seq}.stdout.txt`
        const stderrPath = `run-${seq}.stderr.txt`
        await writeFile(join(options.outDir, stdoutPath), graded.stdout)
        await writeFile(join(options.outDir, stderrPath), graded.stderr)
        runs.push({
          variant,
          category: fixture.id,
          fixtureId: fixture.id,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMs: endedAt.getTime() - startedAt.getTime(),
          execution,
          parentModel: null,
          workers: [],
          agentCalls: variant === 'A' ? 0 : null,
          workUnits: fixture.units.length,
          usage: { unavailable: 'No model usage metadata: this run did not call a provider.' },
          cost: { unavailable: 'Approximate cost is not invented when usage metadata is absent.' },
          filesChanged: [],
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
          reviewFindings: [],
          parentCorrections: [],
          diffCorrect: applyOracle && graded.status === 'passed' ? true : applyOracle && graded.status === 'failed' ? false : null,
          regression: null,
          routing: routingFor(fixture, variant),
        })
      }
    }
  }
  const comparison: AbComparison = {
    generatedAt: new Date().toISOString(),
    execution,
    repetitions,
    liveSkipReason,
    runs,
  }
  await writeFile(join(options.outDir, 'comparison.json'), `${JSON.stringify(comparison, null, 2)}\n`)
  return comparison
}
