/** Deterministic JSON and self-contained HTML reporting for A/B evaluations. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AbComparison, AbRunArtifact, ReviewerArtifact } from './types.ts'

function escapeHtml(value: unknown): string {
  const text = value === null || value === undefined
    ? ''
    : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : JSON.stringify(value)
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null)
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0) / present.length
}

function displayScore(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
}

function reviewDetails(review: ReviewerArtifact): string {
  if (review.status === 'failed') return `<p class="error">Reviewer unavailable: ${escapeHtml(review.error)}</p>`
  const findings = review.findings.length === 0
    ? '<li>No material findings.</li>'
    : review.findings.map(finding => `<li><strong>${escapeHtml(finding.severity)}</strong>${finding.file === null ? '' : ` · ${escapeHtml(finding.file)}`}: ${escapeHtml(finding.description)}</li>`).join('')
  return `<p><strong>${escapeHtml(review.role)}</strong> · ${escapeHtml(review.verdict)} · ${displayScore(review.score)}/100 · confidence ${displayScore(review.confidence)}</p><ul>${findings}</ul>`
}

function runRow(run: AbRunArtifact): string {
  const status = run.validation.status
  const reviewHtml = run.reviews.map(reviewDetails).join('')
  const adjudication = run.adjudication?.triggered === true
    ? `<p><strong>Adjudication:</strong> ${escapeHtml(run.adjudication.verdict ?? run.adjudication.status)} · ${escapeHtml(run.adjudication.rationale ?? run.adjudication.error ?? '')}</p>`
    : ''
  return `<tr>
<td>${run.sequence}</td><td>${escapeHtml(run.category)}</td><td>${escapeHtml(run.variant)}</td><td>${escapeHtml(run.executorId ?? 'keyless')}</td>
<td><span class="status ${status}">${escapeHtml(status)}</span></td><td>${escapeHtml(run.executorOutcome ?? '—')}</td><td>${displayScore(run.qualityScore)}</td><td>${(run.durationMs / 1_000).toFixed(1)}s</td>
<td><details><summary>Evidence</summary><p>${escapeHtml(run.validation.reason)}</p><p><a href="${escapeHtml(run.validation.stdoutPath)}">validation stdout</a> · <a href="${escapeHtml(run.validation.stderrPath)}">validation stderr</a></p>${reviewHtml}${adjudication}</details></td>
</tr>`
}

function sideSummary(runs: AbRunArtifact[], variant: 'A' | 'B'): string {
  const side = runs.filter(run => run.variant === variant)
  const passed = side.filter(run => run.validation.status === 'passed').length
  const scores = average(side.map(run => run.qualityScore))
  const label = side.find(run => run.executorId !== null)?.executorId ?? `Variant ${variant}`
  return `<article><h3>${escapeHtml(label)}</h3><p class="metric">${passed}/${side.length}</p><p>validators passed</p><p>average quality ${displayScore(scores)}</p></article>`
}

/**
 * Render a standalone report from completed comparison runs.
 * @param comparison Evaluation result to present.
 * @param partial Whether the evaluation is still running.
 * @returns Self-contained HTML report.
 */
export function renderComparisonHtml(comparison: AbComparison, partial = false): string {
  const runs = comparison.runs
  const passed = runs.filter(run => run.validation.status === 'passed').length
  const failed = runs.filter(run => run.validation.status === 'failed').length
  const inconclusive = runs.filter(run => run.validation.status === 'inconclusive').length
  const aScore = average(runs.filter(run => run.variant === 'A').map(run => run.qualityScore))
  const bScore = average(runs.filter(run => run.variant === 'B').map(run => run.qualityScore))
  const winner = aScore === null || bScore === null || aScore === bScore ? 'No evidence-backed winner yet' : aScore > bScore ? 'Variant A currently leads' : 'Variant B currently leads'
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Harness A/B report</title>
<style>body{font:15px system-ui,sans-serif;background:#111318;color:#e8eaf0;margin:0;padding:32px}main{max-width:1400px;margin:auto}h1,h2,h3{margin-top:0}.muted{color:#9ca3af}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:24px 0}.cards article{background:#1b1f27;border:1px solid #303641;border-radius:12px;padding:18px}.metric{font-size:28px;font-weight:700;margin:0}table{width:100%;border-collapse:collapse;background:#171a21}th,td{border-bottom:1px solid #303641;padding:10px;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#20242d}.status{padding:3px 8px;border-radius:999px}.passed{background:#163b2b;color:#82e6ad}.failed{background:#492126;color:#ff9a9f}.inconclusive{background:#44391d;color:#f6d365}details{max-width:520px}a{color:#83b8ff}.error{color:#ff9a9f}code{background:#242934;padding:2px 5px;border-radius:4px}</style></head>
<body><main><h1>Codex vs DeepSeek Harness</h1><p class="muted">${partial ? 'Partial report — evaluation still running.' : 'Final report.'} Generated ${escapeHtml(comparison.generatedAt)} · schema ${comparison.schemaVersion}</p>
<h2>${escapeHtml(winner)}</h2><section class="cards">${sideSummary(runs, 'A')}${sideSummary(runs, 'B')}<article><h3>Validation</h3><p class="metric">${passed} / ${failed} / ${inconclusive}</p><p>passed / failed / inconclusive</p></article><article><h3>Completed runs</h3><p class="metric">${runs.length}</p><p>recorded so far</p></article></section>
<h2>Runs</h2><table><thead><tr><th>#</th><th>Task</th><th>Side</th><th>Executor</th><th>Validation</th><th>Agent</th><th>Quality</th><th>Duration</th><th>Details</th></tr></thead><tbody>${runs.map(runRow).join('')}</tbody></table>
</main></body></html>`
}

/**
 * Write the incremental or final machine-readable and HTML reports.
 * @param outDir Evaluation output directory.
 * @param comparison Evaluation result to persist.
 * @param partial Whether to use incremental report filenames.
 * @returns A promise that resolves after both reports are written.
 */
export async function writeComparisonReports(outDir: string, comparison: AbComparison, partial: boolean): Promise<void> {
  const jsonName = partial ? 'comparison.partial.json' : 'comparison.json'
  const htmlName = partial ? 'report.partial.html' : 'report.html'
  await Promise.all([
    writeFile(join(outDir, jsonName), `${JSON.stringify(comparison, null, 2)}\n`),
    writeFile(join(outDir, htmlName), renderComparisonHtml(comparison, partial)),
  ])
}
