# Real-dataset harness benchmark: DSH vs Claude Code

Compares the DSH harness against the Claude Code harness on 130 real tasks from
trusted public benchmarks, both driving `stealth/ox-alpha` through OpenRouter so
the harness is the only variable. Extends the earlier synthetic comparison in
[investigation/overnight-harness-improvement](../investigation/overnight-harness-improvement)
(see [BENCHMARKS.md](../BENCHMARKS.md)).

| Dataset | Tasks | Difficulty | Source | Scoring |
|---|---|---|---|---|
| aider-polyglot | 60 (10 × 6 languages) | medium | terminal-bench-datasets `datasets/aider_polyglot` | native per-language test runners |
| terminal-bench-core | 40 | hard | terminal-bench `original-tasks` | docker-mode (terminal-bench runner) |
| swebench-verified | 30 | hard | terminal-bench-datasets `datasets/swebench-verified` | docker-mode (terminal-bench runner) |

Sampling is deterministic: seed `1337`, sorted-name pools, seeded Fisher-Yates.
`manifest.json` freezes every task id plus a sha256 over each task directory.

## Setup

- OpenRouter auth: set `OPENROUTER_API_KEY`, or reuse the DSH subscription token
  (`~/.dsh/.oauth.json → providers.openrouter.access`; sign in via
  `node --import tsx/esm dsh-login.mts openrouter`). The token is only ever passed
  through process env, never written into the repo.
- Claude Code CLI on PATH (`claude -p …`), pointed at OpenRouter's
  Anthropic-compatible endpoint (`https://openrouter.ai/api/v1/messages`) via
  `ANTHROPIC_BASE_URL=https://openrouter.ai/api`.
- DSH runs from this repo via `node --import tsx/esm apps/cli/src/bin.ts --profile headless "<task>"`,
  with the run workspace as its cwd.
- Docker hosts the two hard datasets; without it those runs are recorded as
  `requires-docker`.

## Workflow

```sh
# 1. fetch + sample datasets, freeze manifest.json
node benchmarks/tools/fetch-datasets.mjs            # clones into /tmp/bench-src

# 2. run headless agents (resumable; skips runs that already have result.json)
node benchmarks/tools/run-benchmark.mjs --reps 2    # full matrix
node benchmarks/tools/run-benchmark.mjs --dataset aider-polyglot --filter python --limit 2   # smoke

# 3. score against dataset-native tests
node benchmarks/tools/score-run.mjs

# 4. aggregate
node benchmarks/tools/aggregate.mjs
```

Fairness controls baked into the runner: identical frozen prompts from
`task.yaml`, isolated workspaces containing only the supplied files (tests are
copied in only after the agent finishes), same model + endpoint for both
harnesses, per-task timeout caps from the dataset metadata, and repetitions.

## Results layout

Run records live under `/tmp/dsh-bench/results/<dataset>__<task>__<harness>__r<N>/`
(override with `DSH_BENCH_RESULTS`), outside the repo so neither harness sees this
repository's own AGENTS.md/CLAUDE.md as ancestor context. Each run holds
`workspace/` (what the agent produced), `stdout.log`, `stderr.log`, `meta.json`,
and `result.json` (status, duration, score). Aggregate summaries belong in
`BENCHMARKS.md` once a full run completes; copy any raw runs worth keeping there
deliberately.
