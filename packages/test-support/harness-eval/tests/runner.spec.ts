import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
        }),
      })
      expect(comparison.runs[0]!.executorOutcome).toBe('completed')
      expect(comparison.runs[0]!.executorTiming?.agentMs).toBe(15)
      expect(comparison.runs[0]!.executorProcess?.status).toBe('inconclusive')
      expect(comparison.runs[0]!.executorProcess?.reason).toBe('process was cancelled')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
