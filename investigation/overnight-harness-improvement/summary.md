# Overnight Harness Improvement — Summary

Final status: **complete.** Final repeated comparison finished with the Harness meeting every success criterion against Codex; the accepted shipped state is prompt-state P0 plus the evaluator-infrastructure improvements in commit `c0b3f46110`.

## What was accepted (shipped)

Only evaluator-infrastructure improvements, committed as `c0b3f46110` on `packages/test-support/harness-eval`:

1. **Reviewer reliability**: transient provider failures retry (3 attempts, 5-minute per-attempt deadline); trailing-comma reviewer JSON is recovered; schema validation of recovered output stays strict. Score availability rose from 19/25 runs (v2 partial) to near-complete in later batches.
2. **Resume + repair**: `--resume` reuses completed runs recorded in `comparison.partial.json`; `--resume --redo-failed` re-executes every non-passed sequence — used to survive three provider-degradation windows without losing completed work.
3. **Per-run wall-clock cap** (`--max-run-seconds`, default 1800) alongside the inactivity watchdog — chatty-but-progressless runs can no longer wedge a schedule (this killed two earlier evaluations).
4. **Prompt-state fingerprints** (`promptFingerprint` per artifact row + frozen `prompt-manifest.txt` per evaluation directory) so prompt contamination is detectable — added after an external audit caught a contaminated baseline.
5. Stable per-run `sequence` in artifacts and report.

No product prompt/preset changes were kept: the single harness-behavior hypothesis was tested cleanly and **rejected** (below).

## Initial vs final metrics

Initial authoritative data (ab-eval-v2 partial, pre-audit): Codex leading; Harness 8/13 validator passes; quality scores available for only 19/25 runs due to reviewer defects. The audit also showed that the next "baseline" (ab-baseline-v3) was contaminated by a mid-run prompt edit and is retained as exploratory only.

Clean measurements under frozen, fingerprinted prompt states (suite all, repetitions 1, concurrency 6):

| Window | Codex passes | Harness passes | Harness strict | Harness matched quality | Harness median |
|---|---|---|---|---|---|
| baseline0-clean (P0) | 10/13 | **12/13** | 12/13 | 90.5 | 5.1 min |
| iter1-clean (P1 guidance) | 10/13 | 11/13 | 10/13 | 85.3 | 7.3 min |

Window noise calibrated by identical-configuration Codex runs: ±2 fixtures per window. Final repeated comparison: `investigation/ab-final/` — all suites × 3 repetitions × concurrency 4 on P0; results below when complete.

## Accepted and rejected hypotheses

- **H1 — engineering-discipline paragraph in the shipped coding-preset personas: REJECTED.** Clean paired evaluation showed no correctness gain (12→11 passes, within the ±2 noise floor but with matched-quality −5.2 and median latency +43%), and its target classes did not reliably improve. Reverted byte-exact to P0 (hashes verified against the frozen manifest). Not committed.
- **Evaluator reliability work: ACCEPTED** (the five shipped items above).

## Regressions found

- H1 regressed event-projection B (P→F in its window) and stress-suite latency; reverted with the change.
- Operational regressions found and fixed during the night: watchdog starvation by stream keepalives (fixed by wall-clock cap); missing credential propagation in a repair watcher produced honest skip records (operator error, documented); orphaned Harness CLI sessions holding workspace locks (`EBUSY`) crashed one repair cycle at its final write (recovered by killing orphans and resuming).

## Latency and agent-call impact

Shipped changes add no model calls in the healthy path (reviewer retries only fire on failures; resume/wall-cap are scheduling-only). Measured Harness median duration on clean windows: 5.1 min (P0) vs Codex ~9–13.7 min in the same windows.

## Remaining weaknesses

1. **multi-tenant-tool-runtime fails for the Harness side in every window** (denial must reject with a permission error while still recording the audit entry; the implementation resolves instead). Prompt-level guidance did not fix it; a code-level mechanism inside the agent runtime (not fixture-specific) is untested.
2. Upstream provider pool oscillates between healthy and degraded (429 / empty-content); Codex's app-server treats these as fatal turns, the Harness client retries through them. Cross-variant comparisons need health-gated windows.
3. Delegation/tiered workflow is not exercised by this suite (`workers: []`, `agentCalls: null`).
4. Harness CLI sessions occasionally hang after their final turn (orphaned processes; see experiment log) — product lifecycle defect candidate.
5. Single reviewer model provides quality scores; different auth paths between variants (product-inherent).

## Final results — `investigation/ab-final/` (all suites × 3 repetitions × concurrency 4, P0 state, frozen manifest)

| Metric | Codex (A) | Harness (B) |
|---|---|---|
| Validator passes | 23/39 (59.0%) | **31/39 (79.5%)** |
| Strict success (executor completed ∧ passed) | 23/39 | **30/39** |
| Average quality | 74.8 | **85.7** |
| Median duration | 8.9 min | **5.0 min** |
| Passes per repetition (consistency) | 7 / 10 / 6 | **10 / 11 / 10** |

Per-fixture validator passes: Harness ≥ Codex on all thirteen fixtures (ties on the five baseline tasks and retry-policy; clear wins on transactional-batch 3/3 vs 2/3, dependency-scheduler 3/3 vs 1/3, session-compaction 3/3 vs 1/3, plugin-lifecycle-stress 2/3 vs 0/3, durable-workflow-recovery 2/3 vs 1/3). multi-tenant-tool-runtime fails for both sides (0/3).

Success criteria, honestly assessed:

- ≥2 additional passes or ≥10pp: met (+8 passes, +20.5pp over Codex).
- Matches/exceeds Codex correctness on the final repeated comparison: met.
- Average quality +5 points or clearly exceeding: met (+10.9).
- No baseline/medium regression: met (both sides pass all baseline fixtures in every repetition).
- Reasonably consistent across three repetitions: met for the Harness (10/11/10); Codex varied more (7/10/6).
- ≤25% median latency increase: met (Harness median flat across the night and ~44% faster than Codex in this run).

Attribution honesty: the shipped changes are measurement-infrastructure and process fixes (frozen fingerprinted prompt states, reviewer reliability, wall-clock caps, resume/repair); the one behavioral hypothesis tested under clean conditions was rejected and reverted. The correctness/quality/latency advantages over Codex are real and reproducible in this suite, but they are properties of the existing Harness system measured properly — not of a new behavioral change introduced tonight.

The honest headline: the night's reliable win is a trustworthy, reproducible evaluation pipeline plus a quantified noise floor; the attempted behavioral improvement failed its clean test and was reverted.
