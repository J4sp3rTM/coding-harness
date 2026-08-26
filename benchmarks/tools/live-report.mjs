/**
 * Generates a self-contained live-report HTML showing EVERY benchmark task:
 * completed / in-flight / not-started, per harness, with scores and durations.
 * Regenerate on a timer (regen loop) and serve statically; page auto-refreshes.
 *
 * Usage:
 *   node benchmarks/tools/live-report.mjs [output-path]   # default: ~/dsh-bench/report.html
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BENCHMARK_ROOT, RESULTS_DIR } from './lib.mjs'

const out = process.argv[2] ?? `${process.env.HOME}/dsh-bench/report.html`

// --- collect recorded + in-flight runs ---------------------------------------
const results = new Map() // dirName -> parsed result.json
const inFlight = new Set()
for (const entry of readdirSync(RESULTS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const resultPath = join(RESULTS_DIR, entry.name, 'result.json')
  if (existsSync(resultPath)) {
    try {
      results.set(entry.name, JSON.parse(readFileSync(resultPath, 'utf8')))
    } catch {
      inFlight.add(entry.name) // mid-write
    }
  } else {
    inFlight.add(entry.name)
  }
}

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const median = v => {
  if (v.length === 0) return null
  const s = [...v].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const strictPass = r => r.status === 'completed' && r.score?.status === 'passed'

// --- per dataset × harness summary -------------------------------------------
const cells = new Map()
for (const r of results.values()) {
  const key = `${r.task?.dataset ?? r.taskKey?.split('/')[0]}|${r.harness}`
  if (!cells.has(key)) cells.set(key, [])
  cells.get(key).push(r)
}
let summaryRows = ''
for (const [key, list] of [...cells.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const done = list.filter(r => r.status === 'completed')
  const scored = done.filter(r => r.score !== undefined)
  const passed = scored.filter(strictPass).length
  const failed = scored.filter(r => !strictPass(r)).length
  const pending = done.length - scored.length
  const mins = median(scored.map(r => (r.durationMs ?? 0) / 60_000))
  const [ds, h] = key.split('|')
  summaryRows += `<tr><td>${esc(ds)}</td><td>${esc(h)}</td><td>${list.length}</td><td class="pass">${passed}</td><td class="fail">${failed}</td><td class="pending">${pending}</td><td>${mins === null ? '—' : mins.toFixed(1) + ' (n=' + scored.length + ')'}</td></tr>`
}

// --- full per-task matrix over the frozen manifest ----------------------------
const manifest = JSON.parse(readFileSync(join(BENCHMARK_ROOT, 'manifest.json'), 'utf8'))
const TOTAL_PLANNED = manifest.tasks.length * 2
const counts = { passed: 0, failed: 0, running: 0, unscored: 0, notstarted: 0 }
const rowHtml = []
for (const t of manifest.tasks) {
  for (const h of ['dsh', 'claude-code']) {
    const dirName = `${t.dataset}__${t.id}__${h}__r1`
    const r = results.get(dirName)
    let state, cls, dur = '', score = ''
    if (r) {
      if (strictPass(r)) { state = 'PASS'; cls = 'pass'; counts.passed++ }
      else if (r.status === 'timeout') { state = 'TIMEOUT'; cls = 'warn'; counts.failed++ }
      else if (r.status === 'container-error') { state = 'CONTAINER-ERR'; cls = 'fail'; counts.failed++ }
      else if (r.score?.status === 'passed') { state = 'PASS'; cls = 'pass'; counts.passed++ }
      else if (r.score !== undefined) { state = `FAIL (${r.status})`; cls = 'fail'; counts.failed++ }
      else { state = `done · ${r.status}, scoring pending`; cls = 'pending'; counts.unscored++; dur = ((r.durationMs ?? 0) / 60000).toFixed(1) }
      if (!dur && r.durationMs) dur = (r.durationMs / 60000).toFixed(1)
      score = r.score?.status ?? '—'
    } else if (inFlight.has(dirName)) {
      state = '▶ RUNNING'; cls = 'run'; counts.running++
    } else {
      state = 'not started'; cls = 'dim'; counts.notstarted++
    }
    rowHtml.push(`<tr data-f="${esc(`${t.dataset} ${t.id} ${h}`.toLowerCase())}"><td>${esc(t.dataset)}</td><td>${esc(t.id)}</td><td>${esc(h)}</td><td class="${cls}">${state}</td><td>${esc(score)}</td><td>${dur}</td><td>${esc(t.difficulty)}</td></tr>`)
  }
}
const totalDone = counts.passed + counts.failed + counts.unscored

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Benchmark live report</title>
<meta http-equiv="refresh" content="60">
<style>
 body { font-family: -apple-system, sans-serif; margin: 1.5rem; background: #111; color: #ddd; }
 h1 { font-size: 1.25rem; margin-bottom: .3rem; } h2 { font-size: .95rem; color: #9ab; margin-top: 1.4rem; }
 table { border-collapse: collapse; margin-top: .5rem; width: 100%; }
 td, th { padding: .28rem .55rem; border-bottom: 1px solid #2c2c2c; text-align: left; font-size: .78rem; }
 th { color: #9ab; position: sticky; top: 0; background: #111; }
 tr:hover td { background: #1b1b1b; }
 .pass { color: #6f6; font-weight: 600; } .fail { color: #f76; font-weight: 600; }
 .pending { color: #fb6; } .run { color: #5cf; font-weight: 600; } .warn { color: #fa0; } .dim { color: #555; }
 .bar { background: #333; height: 14px; width: 420px; border-radius: 7px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: .7rem; }
 .bar > div { background: #4a9; height: 100%; }
 .chip { display: inline-block; background: #222; border: 1px solid #444; border-radius: 10px; padding: .15rem .6rem; margin: .15rem; font-size: .78rem; }
 #q { background: #222; color: #ddd; border: 1px solid #444; border-radius: 6px; padding: .35rem .6rem; width: 300px; font-size: .85rem; }
 .meta { color: #889; font-size: .75rem; }
</style></head><body>
<h1>DSH vs Claude Code — live benchmark</h1>
<div class="bar"><div style="width:${Math.round(totalDone / TOTAL_PLANNED * 100)}%"></div></div>
<b>${totalDone}</b> / ${TOTAL_PLANNED} runs finished &nbsp;·&nbsp; <span class="run">${counts.running} running now</span>
<p class="meta">regenerated ${new Date().toLocaleTimeString()} · auto-refresh every 60s</p>
<div>${Object.entries(counts).map(([k, v]) => `<span class="chip">${k}: <b>${v}</b></span>`).join(' ')}</div>
<h2>Per dataset × harness</h2>
<table><tr><th>dataset</th><th>harness</th><th>runs</th><th>passed</th><th>failed</th><th>scoring-pending</th><th>median min</th></tr>${summaryRows}</table>
<h2>All tasks <input id="q" placeholder="filter… e.g. python · claude · dsh · swebench" oninput="var v=this.value.toLowerCase();document.querySelectorAll('#all tr[data-f]').forEach(r=>{r.style.display=r.dataset.f.includes(v)?'':'none'})"></h2>
<table id="all"><tr><th>dataset</th><th>task</th><th>harness</th><th>state</th><th>score</th><th>min</th><th>difficulty</th></tr>${rowHtml.join('\n')}</table>
</body></html>`

writeFileSync(out, html)
console.log(`wrote ${out} — pass:${counts.passed} fail:${counts.failed} running:${counts.running} not-started:${counts.notstarted}`)
