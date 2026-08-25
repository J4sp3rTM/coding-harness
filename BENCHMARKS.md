# Benchmarks

We compare Conduit against the OpenAI Codex harness on an internal coding-task suite: 13 tasks, 3 repetitions per task, both harnesses on `stealth/ox-alpha` at high effort with the same frozen task prompts. The comparison produced 78 runs.

## Task results

Conduit completed 31 of 39 runs (79.5%). The Codex harness completed 23 of 39 runs (59.0%). Conduit was at least as good as the Codex harness on every task.

## Result quality

A blind reviewer scored each result from 0 to 100. Conduit averaged 85.7. The Codex harness averaged 74.8.

## Speed

The median run took 5.0 minutes on Conduit and 8.9 minutes on the Codex harness.

## Prompt-cache hit rate

Separate from the comparison: Conduit builds each request by appending to the previous request. System-prompt sections keep one fixed order, and finished turns do not change. The stable prefix lets the provider cache serve most input tokens. Measured on OpenRouter from 2026-08-18 to 2026-08-25: 95.6% of `stealth/ox-alpha` tokens came from the cache (867.6 million cached of 907.5 million total). Cached input costs much less than new input, so long sessions cost less.

## Data

- How to run the benchmark: [BENCHMARK.md](BENCHMARK.md)
- Raw results (78 runs): [investigation/overnight-harness-improvement/final-comparison.json](investigation/overnight-harness-improvement/final-comparison.json)
- Readable report: [investigation/overnight-harness-improvement/final-report.html](investigation/overnight-harness-improvement/final-report.html)
- Evaluation script: [investigation/overnight-harness-improvement/tools/compare-evals.mjs](investigation/overnight-harness-improvement/tools/compare-evals.mjs)
