/** Compares two harness-eval comparison.json files into a decision table. */
import { readFileSync } from 'node:fs'

const [baselinePath, candidatePath] = process.argv.slice(2)
if (baselinePath === undefined || candidatePath === undefined) {
  console.error('usage: node compare-evals.mjs <baseline comparison.json> <candidate comparison.json>')
  process.exit(2)
}

const load = path => JSON.parse(readFileSync(path, 'utf8'))
const base = load(baselinePath)
const cand = load(candidatePath)

const key = run => `${run.fixtureId}/${run.variant}`
const index = comparison => new Map(comparison.runs.map(run => [key(run), run]))
const baseIndex = index(base)
const candIndex = index(cand)

const pass = run => run.validation.status === 'passed'
/** Strict success: the agent itself completed AND its workspace passed validation. */
const strictPass = run => run.executorOutcome === 'completed' && run.validation.status === 'passed'
const mean = values => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length)
const median = values => {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const minutes = run => run.durationMs / 60_000

let rows = []
for (const [id, b] of baseIndex) {
  const c = candIndex.get(id)
  if (c === undefined) continue
  rows.push({
    id,
    basePass: pass(b),
    candPass: pass(c),
    baseQ: b.qualityScore,
    candQ: c.qualityScore,
    baseMin: minutes(b),
    candMin: minutes(c),
  })
}

for (const row of rows) {
  const flag = !row.basePass && row.candPass ? 'GAIN ' : row.basePass && !row.candPass ? 'REGRESS' : '     '
  const q = (row.baseQ === null || row.candQ === null) ? '—' : `${row.baseQ.toFixed(0)}->${row.candQ.toFixed(0)}`
  console.log(`${flag} ${row.id.padEnd(40)} pass ${row.basePass ? 'P' : 'F'}->${row.candPass ? 'P' : 'F'}  q ${q.padEnd(9)} min ${row.baseMin.toFixed(1)}->${row.candMin.toFixed(1)}`)
}

const summary = variant => {
  const b = [...baseIndex.values()].filter(run => run.variant === variant)
  const c = [...candIndex.values()].filter(run => run.variant === variant)
  const scoredPairs = c.filter(run => run.qualityScore !== null && baseIndex.get(key(run))?.qualityScore !== null)
  return {
    variant,
    basePassRate: b.filter(pass).length,
    candPassRate: c.filter(pass).length,
    baseStrictRate: b.filter(strictPass).length,
    candStrictRate: c.filter(strictPass).length,
    baseQMatched: mean(scoredPairs.map(run => baseIndex.get(key(run)).qualityScore)),
    candQMatched: mean(scoredPairs.map(run => run.qualityScore)),
    candScored: c.filter(run => run.qualityScore !== null).length,
    baseMedianMin: median(b.map(minutes)),
    candMedianMin: median(c.map(minutes)),
    baseFingerprints: [...new Set(b.map(run => run.promptFingerprint ?? 'none'))],
    candFingerprints: [...new Set(c.map(run => run.promptFingerprint ?? 'none'))],
  }
}

console.log('\n=== summary (pass = validator passed; strict = executor completed AND validator passed) ===')
for (const variant of ['A', 'B']) {
  const s = summary(variant)
  console.log(`${variant}: pass ${s.basePassRate}->${s.candPassRate} | strict ${s.baseStrictRate}->${s.candStrictRate} | q(matched) ${s.baseQMatched?.toFixed(1)}->${s.candQMatched?.toFixed(1)} (scored ${s.candScored}) | median min ${s.baseMedianMin?.toFixed(1)}->${s.candMedianMin?.toFixed(1)}`)
  console.log(`   fingerprints base: ${s.baseFingerprints.join(', ')}`)
  console.log(`   fingerprints cand: ${s.candFingerprints.join(', ')}`)
}
