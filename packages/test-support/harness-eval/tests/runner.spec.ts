import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../src/fixtures.ts'
import { runAbEval } from '../src/runner.ts'

describe('A/B evaluation paths', () => {
  it('keeps every seed failing and every oracle passing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-harness-eval-catalog-'))
    try {
      expect(Object.fromEntries(['baseline', 'medium', 'difficult', 'stress'].map(suite => [suite, FIXTURES.filter(fixture => fixture.suite === suite).length])))
        .toEqual({ baseline: 4, medium: 3, difficult: 3, stress: 3 })
      const seed = await runAbEval({ outDir: join(root, 'seed'), fixtures: FIXTURES })
      const oracle = await runAbEval({ outDir: join(root, 'oracle'), fixtures: FIXTURES, applyOracle: true })
      expect(seed.runs.every(run => run.validation.status === 'failed')).toBe(true)
      expect(oracle.runs.every(run => run.validation.status === 'passed')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves a relative output directory before invoking an executor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-harness-eval-relative-'))
    try {
      const comparison = await runAbEval({
        outDir: relative(process.cwd(), join(root, 'results')),
        fixtures: [FIXTURES[0]!],
        executor: async ({ workdir }) => {
          expect(isAbsolute(workdir)).toBe(true)
          return { skipped: { reason: 'path assertion only' } }
        },
      })
      expect(comparison.runs).toHaveLength(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports ordered progress phases for each run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-harness-eval-progress-'))
    try {
      const phases = []
      await runAbEval({
        outDir: join(root, 'results'),
        fixtures: [FIXTURES[0]!],
        onProgress: (progress) => { phases.push(`${progress.sequence}:${progress.phase}:${progress.totalRuns}`) },
      })
      expect(phases).toEqual([
        '1:run-started:2', '1:workspace-ready:2', '1:validation-started:2', '1:run-completed:2',
        '2:run-started:2', '2:workspace-ready:2', '2:validation-started:2', '2:run-completed:2',
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('runs isolated work concurrently while retaining catalog order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-harness-eval-concurrency-'))
    let active = 0
    let maximum = 0
    try {
      const comparison = await runAbEval({
        outDir: join(root, 'results'),
        fixtures: [FIXTURES[0]!],
        concurrency: 2,
        executor: async () => {
          active += 1
          maximum = Math.max(maximum, active)
          await new Promise(resolve => setTimeout(resolve, 20))
          active -= 1
          return { skipped: { reason: 'concurrency assertion only' } }
        },
      })
      expect(maximum).toBe(2)
      expect(comparison.runs.map(run => run.variant)).toEqual(['A', 'B'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('withholds canonical tests from executors and restores them before validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-harness-eval-validation-isolation-'))
    try {
      const comparison = await runAbEval({
        outDir: join(root, 'results'),
        fixtures: [FIXTURES[0]!],
        executor: async ({ workdir }) => {
          await expect(access(join(workdir, 'test.js'))).rejects.toMatchObject({ code: 'ENOENT' })
          await writeFile(join(workdir, 'test.js'), "console.log('forged pass')\n")
        },
      })
      expect(comparison.runs.map(run => run.validation.status)).toEqual(['failed', 'failed'])
      const canonical = await readFile(join(FIXTURES[0]!.root, 'seed', 'test.js'), 'utf8')
      expect(await readFile(join(root, 'results', 'work-1-A-tiny-localized', 'test.js'), 'utf8')).toBe(canonical)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('writes incremental and final HTML with blind-review scores', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-harness-eval-report-'))
    try {
      const outDir = join(root, 'results')
      const comparison = await runAbEval({
        outDir,
        fixtures: [FIXTURES[0]!],
        applyOracle: true,
        reviewer: async () => ({
          reviews: (['correctness', 'architecture'] as const).map(role => ({
            role,
            status: 'completed' as const,
            provider: 'test',
            model: 'test',
            verdict: 'pass' as const,
            score: 80,
            confidence: 0.9,
            dimensions: { correctness: 4, architecture: 4, robustness: 4, maintainability: 4, efficiency: 4 },
            blockingIssues: [],
            strengths: ['works'],
            findings: [],
            error: null,
          })),
          adjudication: { triggered: false, status: 'not-needed', provider: null, model: null, verdict: null, score: null, rationale: null, error: null },
        }),
      })
      expect(comparison.runs.map(run => run.qualityScore)).toEqual([90, 90])
      expect(await readFile(join(outDir, 'report.html'), 'utf8')).toContain('Codex vs DeepSeek Harness')
      expect(await readFile(join(outDir, 'report.partial.html'), 'utf8')).toContain('Partial report')
      const partial = JSON.parse(await readFile(join(outDir, 'comparison.partial.json'), 'utf8')) as { runs: unknown[] }
      expect(partial.runs).toHaveLength(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('validates CommonJS fixtures beneath an ESM parent directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-harness-eval-esm-parent-'))
    try {
      await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
      const comparison = await runAbEval({
        outDir: join(root, 'results'),
        fixtures: [FIXTURES[0]!],
        applyOracle: true,
      })
      expect(comparison.runs.map(run => run.validation.status)).toEqual(['passed', 'passed'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps a completed executor outcome separate from controlled process teardown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-harness-eval-teardown-'))
    try {
      const comparison = await runAbEval({
        outDir: join(root, 'results'),
        fixtures: [FIXTURES[0]!],
        executor: async () => ({
          executor: 'codex',
          executorOutcome: 'completed',
          executorTiming: { totalMs: 30, startupMs: 10, agentMs: 15, teardownMs: 5 },
          process: { exitCode: 1, timedOut: false, cancelled: true, signal: null },
          promptFingerprint: 'codex/test-fingerprint',
        }),
      })
      expect(comparison.runs[0]!.executorOutcome).toBe('completed')
      expect(comparison.runs[0]!.executorTiming?.agentMs).toBe(15)
      expect(comparison.runs[0]!.executorProcess?.status).toBe('inconclusive')
      expect(comparison.runs[0]!.executorProcess?.reason).toBe('process was cancelled')
      expect(comparison.runs[0]!.promptFingerprint).toBe('codex/test-fingerprint')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resumes an interrupted evaluation from its partial artifact without re-running completed work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-harness-eval-resume-'))
    try {
      const outDir = join(root, 'results')
      const crashed: string[] = []
      await expect(runAbEval({
        outDir,
        fixtures: [FIXTURES[0]!],
        executor: async ({ sequence, variant }) => {
          crashed.push(`${sequence}-${variant}`)
          if (`${sequence}-${variant}` === '2-B') throw new Error('simulated interruption')
          return { skipped: { reason: 'first attempt' } }
        },
      })).rejects.toThrow('simulated interruption')
      expect(crashed).toEqual(['1-A', '2-B'])
      const resumed: string[] = []
      const comparison = await runAbEval({
        outDir,
        fixtures: [FIXTURES[0]!],
        resume: true,
        executor: async ({ sequence, variant }) => {
          resumed.push(`${sequence}-${variant}`)
          return { skipped: { reason: 'second attempt' } }
        },
      })
      expect(resumed).toEqual(['2-B'])
      expect(comparison.runs.map(run => run.sequence)).toEqual([1, 2])
      expect(comparison.runs.map(run => run.skipReason)).toEqual(['first attempt', 'second attempt'])
      expect(comparison.runs.every(run => run.validation.status === 'inconclusive')).toBe(true)
      const final = JSON.parse(await readFile(join(outDir, 'comparison.json'), 'utf8')) as { runs: Array<{ sequence: number }> }
      expect(final.runs.map(run => run.sequence)).toEqual([1, 2])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('re-executes only non-passed runs when resuming with redoFailed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-harness-eval-redo-'))
    try {
      const outDir = join(root, 'results')
      const first: string[] = []
      await runAbEval({
        outDir,
        fixtures: [FIXTURES[0]!],
        executor: async ({ sequence, variant }) => {
          first.push(`${sequence}-${variant}`)
          return { skipped: { reason: 'first attempt' } }
        },
      })
      expect(first).toEqual(['1-A', '2-B'])
      const second: string[] = []
      const comparison = await runAbEval({
        outDir,
        fixtures: [FIXTURES[0]!],
        resume: true,
        redoFailed: true,
        executor: async ({ sequence, variant }) => {
          second.push(`${sequence}-${variant}`)
          return { skipped: { reason: 'second attempt' } }
        },
      })
      // Both recorded runs were inconclusive (skipped), so both re-execute
      // and their artifacts are replaced by the new attempt.
      expect(second).toEqual(['1-A', '2-B'])
      expect(comparison.runs.map(run => run.skipReason)).toEqual(['second attempt', 'second attempt'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails a resume whose saved plan does not match the requested evaluation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-harness-eval-resume-mismatch-'))
    try {
      const outDir = join(root, 'results')
      await runAbEval({ outDir, fixtures: [FIXTURES[0]!] })
      const partialPath = join(outDir, 'comparison.partial.json')
      const partial = JSON.parse(await readFile(partialPath, 'utf8')) as { runs: Array<{ fixtureId: string }> }
      partial.runs = [partial.runs[0]!]
      partial.runs[0]!.fixtureId = FIXTURES[1]!.id
      await writeFile(partialPath, `${JSON.stringify(partial, null, 2)}\n`)
      await expect(runAbEval({
        outDir,
        fixtures: [FIXTURES[0]!, FIXTURES[1]!],
        resume: true,
      })).rejects.toThrow(/does not match the requested evaluation plan/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
