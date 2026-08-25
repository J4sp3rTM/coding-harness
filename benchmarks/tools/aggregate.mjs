/**
 * Aggregates scored benchmark runs into a comparison table: pass@1 and completion
 * per harness × dataset, plus timing. Reads every run dir's result.json under
 * the results directory.
 *
 * Usage:
 *   node benchmarks/tools/aggregate.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { RESULTS_DIR } from './lib.mjs'

const runs = []
for (const entry of readdirSync(RESULTS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const path = join(RESULTS_DIR, entry.name, 'result.json')
  if (!existsSync(path)) continue
  runs.push(JSON.parse(readFileSync(path, 'utf8')))
}

if (runs.length === 0) {
  console.log('no recorded runs under benchmarks/results/')
  process.exit(0)
}

/** Strict success: the agent finished AND the dataset's own tests passed. */
const strictPass = run => run.status === 'completed' && run.score?.status === 'passed'
const median = values => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
}

const cells = new Map()
const datasetOf = run => run.task?.dataset ?? run.taskKey?.split('/')[0] ?? 'unknown'
for (const run of runs) {
  const key = `${datasetOf(run)} × ${run.harness}`
  if (!cells.has(key)) cells.set(key, [])
  cells.get(key).push(run)
}

console.log('dataset × harness      runs  completed  strict-pass  median-min')
for (const [key, cell] of [...cells.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const completed = cell.filter(run => run.status === 'completed')
  console.log(
    key.padEnd(22),
    String(cell.length).padStart(4),
    String(completed.length).padStart(9),
    String(cell.filter(strictPass).length).padStart(11),
    median(completed.map(run => run.durationMs / 60_000))?.toFixed(1).padStart(10) ?? '—',
  )
}

const byStatus = {}
for (const run of runs) {
  const label = `${run.status}${run.score !== undefined ? `/${run.score.status}` : ''}`
  byStatus[label] = (byStatus[label] ?? 0) + 1
}
console.log('\nstatus breakdown:', Object.entries(byStatus).map(([label, count]) => `${label}=${count}`).join(', '))
