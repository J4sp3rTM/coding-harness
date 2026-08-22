import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FIXTURES } from './eval/fixtures.ts'
import { runAbEval, type AbComparison } from './eval/runner.ts'
import { main } from './eval/run.ts'
import { runValidationCommand } from './eval/process.ts'
import { routeTier, shouldDelegate } from '../src/route.ts'

const scratchRoots: string[] = []

afterEach(async () => {
  await Promise.all(scratchRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function outDir(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dsh-ab-${label}-`))
  scratchRoots.push(dir)
  return dir
}

function assertComparison(comparison: AbComparison, execution: AbComparison['execution']): void {
  expect(comparison.execution).toBe(execution)
  expect(comparison.runs.length).toBe(8)
  const variants = new Set(comparison.runs.map(run => run.variant))
  const categories = new Set(comparison.runs.map(run => run.category))
  expect([...variants].sort()).toEqual(['A', 'B'])
  expect([...categories].sort()).toEqual([
    'medium-implementation',
    'repetitive-mechanical',
    'risky-cross-component',
    'tiny-localized',
  ])
  for (const run of comparison.runs) {
    expect(['passed', 'failed', 'inconclusive']).toContain(run.validation.status)
    expect(run.validation.reason).not.toMatch(/PASS/)
    if (run.validation.status === 'passed') {
      expect(run.validation.timedOut).toBe(false)
      expect(run.validation.cancelled).toBe(false)
      expect(run.validation.exitCode).toBe(0)
    }
    expect(run.usage.unavailable.length).toBeGreaterThan(0)
    expect(run.cost.unavailable.length).toBeGreaterThan(0)
    if (run.variant === 'A') expect(run.routing.delegated).toBe(false)
  }
}

describe('A/B eval runner', () => {
  it('grades seed fixtures as failed from process exit, not stdout', async () => {
    const dir = await outDir('seed')
    const comparison = await runAbEval({ outDir: dir, repetitions: 1 })
    assertComparison(comparison, 'keyless-seed')
    expect(comparison.runs.every(run => run.validation.status === 'failed')).toBe(true)
    expect(comparison.runs.every(run => run.validation.exitCode !== 0 && run.validation.exitCode !== null)).toBe(true)
    const tiny = comparison.runs.find(run => run.variant === 'B' && run.category === 'tiny-localized')
    expect(tiny?.routing.delegated).toBe(false)
    expect(tiny?.routing.shippedTiers).toEqual(['T2'])
    expect(tiny?.routing.legacyTiers).toEqual(['T3'])
    const repetitive = comparison.runs.find(run => run.variant === 'B' && run.category === 'repetitive-mechanical')
    expect(repetitive?.routing.delegated).toBe(true)
    expect(repetitive?.routing.shippedTiers).toEqual(['T3'])
    const medium = comparison.runs.find(run => run.variant === 'B' && run.category === 'medium-implementation')
    expect(medium?.routing.shippedTiers).toEqual(['T2'])
    const risky = comparison.runs.find(run => run.variant === 'B' && run.category === 'risky-cross-component')
    expect(risky?.routing.shippedTiers).toEqual(['T2', 'T1'])
    const written = JSON.parse(await readFile(join(dir, 'comparison.json'), 'utf8')) as AbComparison
    expect(written.runs).toHaveLength(8)
  })

  it('grades oracle overlays as passed only after the process exits 0', async () => {
    const dir = await outDir('oracle')
    const comparison = await runAbEval({ outDir: dir, applyOracle: true })
    assertComparison(comparison, 'keyless-oracle')
    expect(comparison.runs.every(run => run.validation.status === 'passed')).toBe(true)
    expect(comparison.runs.every(run => run.diffCorrect === true)).toBe(true)
    const stdout = await readFile(join(dir, comparison.runs[0]!.validation.stdoutPath), 'utf8')
    expect(stdout).toContain('PASS')
    expect(comparison.runs[0]!.validation.status).toBe('passed')
  })

  it('launches the real runner entry point twice with identical structure', async () => {
    const first = await outDir('entry-1')
    const second = await outDir('entry-2')
    expect(await main(['--out', first])).toBe(0)
    expect(await main(['--out', second])).toBe(0)
    const a = JSON.parse(await readFile(join(first, 'comparison.json'), 'utf8')) as AbComparison
    const b = JSON.parse(await readFile(join(second, 'comparison.json'), 'utf8')) as AbComparison
    assertComparison(a, 'keyless-seed')
    assertComparison(b, 'keyless-seed')
    expect(a.runs.map(run => [run.variant, run.category, run.validation.status]))
      .toEqual(b.runs.map(run => [run.variant, run.category, run.validation.status]))
  })

  it('records a live skip without inventing a Variant B win', async () => {
    const dir = await outDir('live')
    const comparison = await runAbEval({ outDir: dir, live: true })
    expect(comparison.execution).toBe('live-skipped')
    expect(comparison.liveSkipReason).toMatch(/DEEPSEEK_API_KEY|accepted comparison/)
    expect(comparison.runs.some(run => run.validation.status === 'passed' && run.execution === 'live')).toBe(false)
  })

  it('times out a hanging validation as inconclusive even if stdout already looks successful', async () => {
    const dir = await outDir('hang')
    const hanging = join(dir, 'hang.js')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(hanging, 'process.stdout.write("PASS\\n"); setInterval(() => {}, 1000)\n')
    const graded = await runValidationCommand({
      command: process.execPath,
      args: [hanging],
      cwd: dir,
      timeoutMs: 200,
    })
    expect(graded.stdout).toContain('PASS')
    expect(graded.status).toBe('inconclusive')
    expect(graded.timedOut).toBe(true)
  }, 10_000)
})

describe('fixture routing signals', () => {
  it('encodes the four expected routing outcomes', () => {
    const byId = Object.fromEntries(FIXTURES.map(fixture => [fixture.id, fixture]))
    expect(shouldDelegate(byId['tiny-localized']!.units)).toBe(false)
    expect(routeTier(byId['tiny-localized']!.units[0]!)).toBe('T2')
    expect(shouldDelegate(byId['repetitive-mechanical']!.units)).toBe(true)
    expect(routeTier(byId['repetitive-mechanical']!.units[0]!)).toBe('T3')
    expect(routeTier(byId['medium-implementation']!.units[0]!)).toBe('T2')
    expect(byId['risky-cross-component']!.units.map(unit => routeTier(unit))).toEqual(['T2', 'T1'])
  })
})
