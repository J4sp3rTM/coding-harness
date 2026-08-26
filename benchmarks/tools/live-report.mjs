/**
 * Generates a self-contained live-report HTML from the current benchmark state.
 * Regenerate it on a timer (see auto-save.sh) and open it via any static server.
 *
 * Usage:
 *   node benchmarks/tools/live-report.mjs [output-path]   # default: ~/dsh-bench/report.html
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RESULTS_DIR } from './lib.mjs'

const out = process.argv[2] ?? `${process.env.HOME}/dsh-bench/report.html`
const runs = []
for (const entry of readdirSync(RESULTS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const path = join(RESULTS_DIR, entry.name, 'result.json')
  if (!existsSync(path)) continue
  try {
    const r = JSON.parse(readFileSync(path, 'utf8'))
    runs.push(r)
  } catch {
    // mid-write; skip
  }
}

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const median = v => {
  if (v.length === 0) return null
  const s = [...v].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const strictPass = r => r.status === 'completed' && r.score?.status === 'passed'

const cells = new Map()
for (const r of runs) {
  const key = `${r.task?.dataset ?? r.taskKey?.split('/')[0]} × ${r.harness}`
  if (!cells.has(key)) cells.set(key, { list: [] })
  cells.get(key).list.push(r)
}

let tableRows = ''
for (const [key, { list }] of [...cells.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const done = list.filter(r => r.status === 'completed')
  const passed = list.filter(strictPass).length
  const mins = median(done.map(r => (r.durationMs ?? 0) / 60_000))
  tableRows += `<tr><td>${esc(key)}</td><td>${list.length}</td><td>${done.length}</td><td class="pass">${passed}</td><td class="fail">${done.length - passed}</td><td>${mins === null ? '—' : mins.toFixed(1)}</td></tr>`
}

const byStatus = {}
for (const r of runs) {
  const label = `${r.status}${r.score !== undefined ? '/' + r.score.status : ''}`
  byStatus[label] = (byStatus[label] ?? 0) + 1
}
const statusHtml = Object.entries(byStatus).map(([k, v]) => `<span class="chip">${esc(k)}: <b>${v}</b></span>`).join(' ')

const recent = runs
  .filter(r => r.status !== undefined)
  .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
  .slice(0, 12)

const TOTAL_PLANNED = 260
const pct = Math.min(100, Math.round((runs.length / TOTAL_PLANNED) * 100))

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Benchmark live report</title>
<meta http-equiv="refresh" content="30">
<style>
 body { font-family: -apple-system, sans-serif; margin: 2rem; background: #111; color: #ddd; }
 h1 { font-size: 1.3rem; } h2 { font-size: 1rem; color: #9ab; margin-top: 1.5rem; }
 table { border-collapse: collapse; margin-top: .5rem; }
 td, th { padding: .35rem .8rem; border-bottom: 1px solid #333; text-align: left; font-size: .85rem; }
 th { color: #9ab; }
 .pass { color: #6f6; } .fail { color: #f76; }
 .bar { background: #333; height: 14px; width: 420px; border-radius: 7px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: .7rem; }
 .bar > div { background: #4a9; height: 100%; }
 .chip { display: inline-block; background: #222; border: 1px solid #444; border-radius: 10px; padding: .15rem .6rem; margin: .15rem; font-size: .78rem; }
 .meta { color: #889; font-size: .75rem; }
</style></head><body>
<h1>DSH vs Claude Code — live benchmark</h1>
<div class="bar"><div style="width:${pct}%"></div></div> ${runs.length} / ${TOTAL_PLANNED} planned runs (${pct}%)
<p class="meta">regenerated ${new Date().toLocaleTimeString()} · page auto-refreshes every 30s</p>
<h2>Status breakdown</h2><div>${statusHtml}</div>
<h2>Per dataset × harness</h2>
<table><tr><th>cell</th><th>runs</th><th>completed</th><th>strict-pass</th><th>failed</th><th>median min</th></tr>${tableRows}</table>
<h2>Slowest completed runs</h2>
<table><tr><th>run</th><th>status</th><th>score</th><th>min</th></tr>
${recent.map(r => `<tr><td>${esc(r.runId.slice(0, 70))}</td><td>${esc(r.status)}</td><td>${esc(r.score?.status ?? '—')}</td><td>${((r.durationMs ?? 0) / 60000).toFixed(1)}</td></tr>`).join('\n')}
</table>
</body></html>`

writeFileSync(out, html)
console.log(`wrote ${out} (${runs.length} runs)`)
