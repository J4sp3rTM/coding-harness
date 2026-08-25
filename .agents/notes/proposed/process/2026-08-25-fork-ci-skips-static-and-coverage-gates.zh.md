# Agent Note: Fork CI 跳过静态、覆盖率与消费者门禁

Status: proposed

[English](2026-08-25-fork-ci-skips-static-and-coverage-gates.md) | 中文

## 问题

在 `deepseek-ai/deepseek-harness` 之外，pull request 会在未运行 lint、hygiene、`doc-sync` 叶子门禁、覆盖率和构建消费者尾部的情况下报告 `all checks passed`。

[ci.yml](../../../../.github/workflows/ci.yml) 中的三个 job 承载这些门禁：`node-24` 运行 `check:ci:static`，`node-24-coverage` 运行 `check:ci:coverage`，`node-24-consumers` 运行 `check:ci:consumers`。每个都请求只有上游组织提供的 larger runner 标签（`dsh-ubuntu-24-04-16core`），因此都由 `github.repository == 'deepseek-ai/deepseek-harness'` 守卫。随后 `all-checks-passed` 聚合 job 在该仓库之外将这三个 job 排除在 skip 检查之外。该守卫本身正确——这些标签在别处无法解析，未加守卫的 job 会永远排队——但它产生的结论与真实通过无法区分。

[可移植 pull-request CI 边界](../../implemented/process/2026-07-23-portable-required-pull-request-ci.md)已经否决了在容量不可用时降级检查，理由是这样做是靠丢弃证据让状态变绿，而不是靠运行仓库的必需约定。该 note 管辖上游拓扑，其中每次 skip 都是致命的。本提案把同一原则扩展到聚合 job 仍然豁免的唯一位置，不改变它所拥有的上游资源池。

这一缺口并非理论。一次 checkpoint 提交删除了 2090 个 Agent Note 文件和 21 个 skill 文件，而 `AGENTS.md`、`packages/AGENTS.md` 和十四个源文件仍在引用它们。`verify-md-links` 和 `verify-doc-refs` 拥有该失败且位于 `ci-static` 中，因此该删除产生了 674 个无法解析的链接，并让分支保持绿色六天，直到有人手动运行这些门禁。

第二个实例影响本地运行：`run-gates` 以 `node $npm_execpath` 启动每个门禁，这要求 pnpm 的 JavaScript 入口。当 pnpm 以 `@pnpm/exe` 独立二进制安装时，Node 会把该二进制当作 ES 模块解析，全部门禁在两秒内以 `SyntaxError: Invalid or unexpected token` 失败。该失败在全部 28 个门禁上一致出现，因此看起来像仓库范围的漂移而非启动器缺陷。

## 提案

解析 runner 标签而非仓库，使守卫不再决定门禁是否运行：

- 将每个 `if` 替换为 `github.event_name == 'pull_request'`，并为每个 `runs-on` 表达式追加最后一个 `|| 'ubuntu-latest'` 分支，在 `github.repository` 不是上游仓库时选中。
- 删除 `all-checks-passed` skip 条件中的三 job 豁免，使每次 skip 在任何地方都致命。
- 从所选 runner 解析 `DSH_GATE_CONCURRENCY`，而不是固定的 `'8'`（为十六核调优）。[larger runner 决策](../../implemented/process/2026-07-22-evidence-based-larger-hosted-runners.md)拥有各主机的 worker 上限，并要求实测而非依据标称核数。

将此排在目标仓库文档门禁转绿之后。在链接漂移未解决时启用 `ci-static`，会让每个 pull request 在首次运行即变红。

对于 `run-gates`，检测非 JavaScript 的 `npm_execpath` 并直接启动它，而不经由 `process.execPath`。当前形式的存在是为了让 Windows 绝不通过 shell 启动 `pnpm.cmd` shim；二进制入口在所有平台上都可以不经 shell 启动，因此该 Windows 约束得以保留。

## 考虑过的替代方案

**保留守卫并依赖本地检查。** 否决：仓库要求证据与改动面相匹配，而上述删除表明，没人运行的门禁就是没人运行的门禁。它还会让 `all checks passed` 报告一个它并未计算的结论。

**新增一个精简的仅 fork job。** 否决：它会复制门禁清单，且在新增叶子门禁时立刻与 `run-gates` 产生漂移。现有 job 已经通过一个脚本命名各自的套件。

**只启用 `ci-static`。** 推迟而非否决。它以最小的运行成本换来 lint、hygiene 和文档检查，而覆盖率是双核 runner 上最昂贵的 job。若完整集合过慢，值得作为第一个增量采用。

## 验收标准

fork 上的 pull request 会为静态、覆盖率和消费者 job 报告真实结果；其中任一失败或被跳过时，`all checks passed` 失败。在 pnpm 为独立二进制的主机上，`pnpm run doc-sync` 能够完成。

## 风险

覆盖率会在标准托管 runner 上运行完整套件，可能超出 job 时间上限；并发默认值是按 larger runner 设定的，需要实测而非假设。启用门禁会暴露 fork 已有的全部漂移——这正是目的，但会以一片红色的形式集中到来。上游仓库的行为不得改变：其 job 保留 larger runner 标签，其 skip 保持致命。
