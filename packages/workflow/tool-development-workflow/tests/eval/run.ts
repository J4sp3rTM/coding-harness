/**
 * CLI entry for the development-workflow A/B runner.
 * Usage: node --import tsx/esm tests/eval/run.ts --out <dir> [--oracle] [--live] [--repetitions N]
 */
import { parseArgs } from 'node:util'
import { runAbEval } from './runner.ts'

/**
 * Parse argv and write comparison artifacts.
 * @param argv - arguments after the script name.
 * @returns process exit code.
 */
export async function main(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    options: {
      out: { type: 'string' },
      oracle: { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
      repetitions: { type: 'string', default: '1' },
    },
  })
  const outDir = parsed.values.out
  if (outDir === undefined || outDir.length === 0) {
    process.stderr.write('usage: run.ts --out <dir> [--oracle] [--live] [--repetitions N]\n')
    return 2
  }
  const repetitions = Number(parsed.values.repetitions)
  if (!Number.isSafeInteger(repetitions) || repetitions < 1) {
    process.stderr.write('repetitions must be a positive integer\n')
    return 2
  }
  const comparison = await runAbEval({
    outDir,
    repetitions,
    applyOracle: parsed.values.oracle,
    live: parsed.values.live,
  })
  process.stdout.write(`${JSON.stringify({
    execution: comparison.execution,
    liveSkipReason: comparison.liveSkipReason,
    runs: comparison.runs.length,
    outDir,
  }, null, 2)}\n`)
  return 0
}

const invoked = process.argv[1] !== undefined && (process.argv[1].endsWith('run.ts') || process.argv[1].endsWith('run.js'))
if (invoked) {
  void main().then((code) => {
    process.exitCode = code
  }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
