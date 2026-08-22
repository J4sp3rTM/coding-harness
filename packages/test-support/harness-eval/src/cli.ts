/** CLI entry point for the deterministic A/B evaluator. */
import { parseArgs } from 'node:util'
import {
  OX_ALPHA_MODEL,
  OX_ALPHA_REASONING_EFFORT,
  createCodexVsHarnessExecutor,
} from './executors.ts'
import { runAbEval, type AbEvalProgress } from './runner.ts'
import { FIXTURES } from './fixtures.ts'
import type { FixtureSuite } from './types.ts'

const SUITES = new Set<FixtureSuite | 'all'>(['baseline', 'medium', 'difficult', 'stress', 'all'])

/** Render one concise progress line for an interactive CLI run. */
export function formatProgress(progress: AbEvalProgress, live: boolean): string {
  const side = live
    ? progress.variant === 'A' ? 'A/Codex' : 'B/DeepSeek Harness'
    : progress.variant
  const prefix = `[${progress.sequence}/${progress.totalRuns}] ${progress.suite}/${progress.fixtureId} · ${side}`
  const elapsed = `${(progress.elapsedMs / 1_000).toFixed(1)}s`
  if (progress.phase === 'run-started') return `${prefix} · started`
  if (progress.phase === 'workspace-ready') return `${prefix} · workspace ready`
  if (progress.phase === 'executor-started') return `${prefix} · agent running`
  if (progress.phase === 'executor-completed') return `${prefix} · agent ${progress.executorOutcome ?? 'finished'} (${elapsed})`
  if (progress.phase === 'validation-started') return `${prefix} · validation running`
  return `${prefix} · ${progress.validationStatus ?? 'inconclusive'} (${elapsed})`
}

/** Parse command-line options and write a comparison artifact. */
export async function main(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    options: {
      out: { type: 'string' },
      oracle: { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
      repetitions: { type: 'string', default: '1' },
      concurrency: { type: 'string', default: '1' },
      suite: { type: 'string', default: 'baseline' },
    },
  })
  const outDir = parsed.values.out
  if (outDir === undefined || outDir.length === 0) {
    process.stderr.write('usage: harness-eval --out <dir> [--oracle | --live] [--repetitions N] [--concurrency N] [--suite baseline|medium|difficult|stress|all]\n')
    return 2
  }
  if (parsed.values.oracle && parsed.values.live) {
    process.stderr.write('--oracle and --live are mutually exclusive\n')
    return 2
  }
  const repetitions = Number(parsed.values.repetitions)
  if (!Number.isSafeInteger(repetitions) || repetitions < 1) {
    process.stderr.write('repetitions must be a positive integer\n')
    return 2
  }
  const concurrency = Number(parsed.values.concurrency)
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    process.stderr.write('concurrency must be a positive integer\n')
    return 2
  }
  const live = parsed.values.live
  const suite = parsed.values.suite
  if (!SUITES.has(suite as FixtureSuite | 'all')) {
    process.stderr.write('suite must be baseline, medium, difficult, stress, or all\n')
    return 2
  }
  const fixtures = suite === 'all' ? FIXTURES : FIXTURES.filter(fixture => fixture.suite === suite)
  const comparison = await runAbEval({
    outDir,
    repetitions,
    concurrency,
    fixtures,
    applyOracle: parsed.values.oracle,
    onProgress: (progress) => { process.stderr.write(`${formatProgress(progress, live)}\n`) },
    ...live
      ? {
        executor: createCodexVsHarnessExecutor(),
        executorMetadata: {
          id: 'codex-vs-deepseek-harness',
          version: '1',
          evidence: [
            `Variant A: Codex with ${OX_ALPHA_MODEL} (${OX_ALPHA_REASONING_EFFORT})`,
            `Variant B: DeepSeek Harness Code preset with ${OX_ALPHA_MODEL} (${OX_ALPHA_REASONING_EFFORT})`,
          ],
        },
      }
      : {},
  })
  process.stdout.write(`${JSON.stringify({
    schemaVersion: comparison.schemaVersion,
    execution: comparison.execution,
    runs: comparison.runs.length,
    skipped: comparison.runs.filter(run => run.skipReason !== null).length,
    concurrency,
    outDir,
  }, null, 2)}\n`)
  return 0
}

const invoked = process.argv[1] !== undefined && (process.argv[1].endsWith('cli.ts') || process.argv[1].endsWith('cli.js'))
if (invoked) {
  void main().then((code) => { process.exitCode = code }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
