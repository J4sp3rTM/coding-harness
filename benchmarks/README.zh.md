# 真实数据集 harness 基准测试：DSH 对比 Claude Code

[English](README.md) | 中文

在 130 个来自可信公开基准测试的真实任务上，比较 DSH harness 与 Claude Code harness；两者都通过 OpenRouter 驱动 `stealth/ox-alpha`，因此唯一变量是 harness。本文扩展了 [investigation/overnight-harness-improvement](../investigation/overnight-harness-improvement) 中更早的合成对比（见 [BENCHMARKS.md](../BENCHMARKS.md)）。

| 数据集 | 任务数 | 难度 | 来源 | 评分 |
|---|---|---|---|---|
| aider-polyglot | 60（10 × 6 种语言） | 中等 | terminal-bench-datasets `datasets/aider_polyglot` | 各语言原生测试运行器 |
| terminal-bench-core | 40 | 困难 | terminal-bench `original-tasks` | docker-mode（terminal-bench 运行器） |
| swebench-verified | 30 | 困难 | terminal-bench-datasets `datasets/swebench-verified` | docker-mode（terminal-bench 运行器） |

抽样是确定性的：种子为 `1337`，按名称排序的任务池，带种子的 Fisher-Yates。`manifest.json` 冻结每个任务 id，以及每个任务目录的 sha256。

## 准备

- OpenRouter 认证：设置 `OPENROUTER_API_KEY`，或复用 DSH 订阅 token（`~/.dsh/.oauth.json → providers.openrouter.access`；通过 `node --import tsx/esm dsh-login.mts openrouter` 登录）。该 token 只会通过进程环境变量传递，从不写入仓库。
- PATH 上要有 Claude Code CLI（`claude -p …`），并通过 `ANTHROPIC_BASE_URL=https://openrouter.ai/api` 指向 OpenRouter 的 Anthropic 兼容端点（`https://openrouter.ai/api/v1/messages`）。
- DSH 从本仓库通过 `node --import tsx/esm apps/cli/src/bin.ts --profile headless "<task>"` 运行，并以本次运行的 workspace 作为 cwd。
- Docker 承载两个困难数据集；没有 Docker 时，这些运行会记为 `requires-docker`。

## 工作流

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

运行器内置了公平性控制：使用 `task.yaml` 中相同的冻结提示词、只包含所提供文件的隔离 workspace（测试仅在 agent（智能体）结束后才复制进去）、两个 harness 使用相同的模型和端点、来自数据集元数据的逐任务超时上限，以及重复运行。

## 结果布局

运行记录存放在 `/tmp/dsh-bench/results/<dataset>__<task>__<harness>__r<N>/`（可用 `DSH_BENCH_RESULTS` 覆盖），位于仓库之外，这样任一 harness 都不会把本仓库自己的 AGENTS.md/CLAUDE.md 当作祖先上下文读到。每次运行包含 `workspace/`（agent 产出的内容）、`stdout.log`、`stderr.log`、`meta.json` 和 `result.json`（状态、耗时、分数）。完整运行结束后，汇总摘要应写入 `BENCHMARKS.md`；值得保留的原始运行请有意复制到该处。
