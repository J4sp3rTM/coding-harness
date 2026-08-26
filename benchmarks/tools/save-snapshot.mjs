/**
 * Copies the score-bearing result JSONs and aggregate table out of the live
 * results directory into the repo so a reboot cannot take them again.
 *
 * Usage:
 *   node benchmarks/tools/save-snapshot.mjs   # writes benchmarks/snapshot-<ts>/
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BENCHMARK_ROOT, RESULTS_DIR, REPO_ROOT } from './lib.mjs'

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const target = process.argv[2] ?? join(BENCHMARK_ROOT, `snapshot-${stamp}`)
mkdirSync(target, { recursive: true })

let saved = 0
for (const entry of readdirSync(RESULTS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const resultPath = join(RESULTS_DIR, entry.name, 'result.json')
  if (!existsSync(resultPath)) continue
  cpSync(resultPath, join(target, `${entry.name}.json`))
  saved += 1
}

// Aggregate table computed from the same records.
const runs = []
for (const entry of readdirSync(RESULTS_DIR, { withFileTypes: true })) {
  const path = join(RESULTS_DIR, entry.name, 'result.json')
  if (!existsSync(path)) continue
  try {
    runs.push(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    // A run dir mid-write; skip it.
  }
}

const strictPass = r => r.status === 'completed' && r.score?.status === 'passed'
const median = v => {
  if (v.length === 0) return null
  const s = [...v].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const cells = new Map()
for (const r of runs) {
  const key = `${r.task?.dataset ?? r.taskKey?.split('/')[0]} × ${r.harness}`
  if (!cells.has(key)) cells.set(key, [])
  cells.get(key).push(r)
}

let md = `# Benchmark snapshot ${stamp}\n\n`
md += '| dataset × harness | runs | completed | strict-pass | median-min |\n|---|---|---|---|---|\n'
for (const [key, cell] of [...cells.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const done = cell.filter(r => r.status === 'completed')
  const mins = median(done.map(r => r.durationMs / 60_000))
  md += `| ${key} | ${cell.length} | ${done.length} | ${cell.filter(strictPass).length} | ${mins === null ? '—' : mins.toFixed(1)} |\n`
}
md += `\nTotal runs recorded: ${runs.length}\n`
writeFileSync(join(target, 'aggregate.md'), md)

console.log(`saved ${saved} results + aggregate.md to ${target.replace(REPO_ROOT + '/', '')}`)
