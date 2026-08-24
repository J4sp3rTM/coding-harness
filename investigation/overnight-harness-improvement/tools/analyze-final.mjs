/** Aggregates a multi-repetition comparison.json into per-rep and overall tables. */
import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (path === undefined) {
  console.error('usage: node analyze-final.mjs <comparison.json>')
  process.exit(2)
}
const c = JSON.parse(readFileSync(path, 'utf8'))
const perRep = Math.round(c.runs.length / c.repetitions)

const mean = values => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length)
const median = values => {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

for (let rep = 0; rep < c.repetitions; rep += 1) {
  const runs = c.runs.filter(run => run.sequence > rep * perRep && run.sequence <= (rep + 1) * perRep)
  console.log(`--- repetition ${rep + 1} (${runs.length} runs) ---`)
  for (const variant of ['A', 'B']) {
    const side = runs.filter(run => run.variant === variant)
    const passed = side.filter(run => run.validation.status === 'passed').length
    const strict = side.filter(run => run.executorOutcome === 'completed' && run.validation.status === 'passed').length
    const scored = side.filter(run => run.qualityScore !== null).map(run => run.qualityScore)
    const mins = median(side.map(run => run.durationMs / 60_000))
    console.log(`${variant}: pass ${passed}/${side.length} strict ${strict}/${side.length} avgQ ${mean(scored)?.toFixed(1)} (scored ${scored.length}) medianMin ${mins?.toFixed(1)}`)
    console.log(`   failures: ${side.filter(run => run.validation.status !== 'passed').map(run => `${run.category}${run.executorOutcome !== 'completed' ? ` [${run.executorOutcome}]` : ''}`).join(', ') || 'none'}`)
  }
}

console.log('=== aggregate across repetitions ===')
for (const variant of ['A', 'B']) {
  const side = c.runs.filter(run => run.variant === variant)
  const passed = side.filter(run => run.validation.status === 'passed').length
  const strict = side.filter(run => run.executorOutcome === 'completed' && run.validation.status === 'passed').length
  const scored = side.filter(run => run.qualityScore !== null).map(run => run.qualityScore)
  console.log(`${variant}: pass ${passed}/${side.length} strict ${strict}/${side.length} avgQ ${mean(scored)?.toFixed(1)} medianMin ${median(side.map(run => run.durationMs / 60_000))?.toFixed(1)}`)
  const byFixture = {}
  for (const run of side) {
    byFixture[run.category] ??= { passes: 0, total: 0 }
    byFixture[run.category].total += 1
    if (run.validation.status === 'passed') byFixture[run.category].passes += 1
  }
  console.log('   per-fixture passes: ' + Object.entries(byFixture).map(([cat, s]) => `${cat} ${s.passes}/${s.total}`).join(', '))
}
