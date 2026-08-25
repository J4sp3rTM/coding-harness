# `@deepseek-ai/dsh-harness-eval`

[English](README.md) | 中文

这是用于确定性 A/B 评估的私有支持基础设施。它拥有 seed/oracle fixture 目录、托管进程执行、基于完成事实的验证分类器、真实的 Codex 与 DeepSeek Harness 适配器、带版本的比较产物和 CLI。默认模式只复制 fixture 并运行验证命令，不调用模型。

## 无密钥评估

使用 `node --import tsx/esm packages/test-support/harness-eval/src/cli.ts --out <dir>` 运行源 CLI。加入 `--oracle` 可在验证前覆盖通过验证的源文件，加入 `--repetitions N` 可重复 A/B 矩阵，加入 `--concurrency N` 可并行执行隔离的 run。concurrency 默认为一，以保持 latency 测量可直接比较。`--stall-timeout-seconds N` 控制 inactivity watchdog，默认为 600 秒；`--max-run-seconds N` 为每个 executor run 增加wall-clock 上限（默认 1800），即使流仍在产生输出也会触发，避免喋喋不休但无进展的 run 阻塞整个计划。除此之外活跃的 run 没有其他 deadline。`--resume` 从部分比较产物继续被中断的评估。`--suite baseline` 是包含四项任务的默认 smoke suite；`medium`、`difficult` 和 `stress` 分别选择三项逐步增加难度的任务，`all` 则选择全部十三项任务。CLI 将 run、workspace、agent、validation 和 completion 进度写入 stderr，并在 stdout 保持最终 JSON 摘要。比较结果写入 `comparison.json`，验证 stdout 和 stderr 分别保留在证据文件中。

验证状态只根据已确认的进程完成事实得出。`passed` 必须有零退出码；超时、取消、缺少状态和终止信号分别分类。输出文本（包括 `PASS` 行）不会改变状态。

agent 运行期间不存在规范 validation 文件。executor 完成后，runner 才从 fixture seed 恢复这些文件，并覆盖 agent 创建的任何同名文件，然后启动 validation。agent 会收到 task、实现源码和编辑一次性 workspace 所需的 runtime metadata，但不会收到预期测试或 oracle 源码。

产物包含 `schemaVersion: 2`。usage 和 cost 使用规范化的可空字段：缺少提供方元数据时使用 `null`，不会伪造估算值。产品结果、进程完成、fixture validation、blind review、adjudication 和组合 quality score 保持为独立字段。每个 run 记录其执行所用模型可见提示输入的 `promptFingerprint`（Harness 侧为 preset 组合文件，Codex 侧为适配器配置），使批次中的提示状态污染可以在产物中被发现。受控 app-server teardown 不会覆盖已完成的模型结果，stalled executor 也不会按普通错误方案评分。可观察的 executor 时间拆分为 startup、agent 和 teardown 三段。`runAbEval` 接受 executor 与 reviewer 回调。非跳过 executor 之后始终独立运行 fixture validation。executor 可以返回跳过原因；该运行保留为 `inconclusive`，比较继续进行。它不会根据 API key 推断 live 运行。

## Codex 与 DeepSeek Harness 对比

使用 `node --import tsx/esm packages/test-support/harness-eval/src/cli.ts --out <dir> --live` 运行真实比较。Variant A 通过隔离的 `CODEX_HOME`、OpenRouter Responses 提供方以及由一次性 fixture 工作区限制的 `danger-full-access` 运行官方 Codex app-server。Variant B 通过 preset 服务挂载随产品发布的 `code` preset，并运行 DeepSeek Harness 源码 CLI。两个 variant 都使用 reasoning effort 为 `high` 的 `stealth/ox-alpha`，并接收同一份不含仓库指令文件的 fixture 副本。

Codex 需要显式的 `OPENROUTER_API_KEY`。其隔离配置会禁用 plugin、plugin 推荐、远程 plugin 目录、更新检查和 shell snapshot，避免无关的首次运行设置进入 agent 时间。在 Windows 上，适配器优先使用 Codex Desktop 本地应用数据目录中随附的可执行文件，否则使用常规 PATH 启动器。DeepSeek Harness 从所选 Harness OAuth 文档读取现有 OpenRouter 订阅，但评估 session 和设置使用临时 `DSH_HOME`。凭证只在进程边界传递，不会写入结果产物。缺少凭证时，该侧会记录为 skipped，绝不会成为通过结果。每次完成的模型运行之后都会独立执行 fixture 验证命令，正确性只由其已确认的退出事实决定。

validation 之后，两个独立的 `stealth/ox-alpha` context 会在不知道 variant 或 executor 身份的情况下审查候选结果。一个关注 correctness 与 robustness，另一个关注 architecture 与 maintainability。verdict 不同或 score 相差至少二十分时，才会触发第三次 adjudication 调用。组合 score 为客观 validation 保留五十分，并按 reviewer dimension 计入 architecture、robustness、maintainability 和 efficiency。reviewer 失败会保持可见，且绝不会伪造 score。

每个完成的 run 都会刷新 `comparison.partial.json` 和 `report.partial.html`。全部完成后写入 `comparison.json` 与独立的 `report.html`，其中包含逐 run validation evidence、blind finding、adjudication、timing 和 A/B 汇总结果。

被中断的评估不会丢失已完成的 run：在同一输出目录用相同命令加 `--resume` 重新运行，已记录在 `comparison.partial.json` 中的完成 run 会被复用而不再执行。再加 `--redo-failed` 时只复用通过的 run，其余序列全部重新执行，用于提供方故障导致整批失败而不反映被测产品的场景。保存的计划——schema 版本、execution 模式、重复次数、executor 身份以及每个 run 的 fixture 与 variant——必须与请求的计划一致，否则 resume 会显式失败。reviewer 调用对提供方瞬时故障最多重试三次，每次尝试有五分钟的超时，并恢复带尾随逗号的 reviewer JSON 输出；对恢复后的输出，schema 校验仍然严格。

## 模型体验

无，因为评估器只提交 fixture 的普通用户任务，并将系统指令和工具组合交给所选的 Codex 或 DeepSeek Harness runtime。

#### KV Cache 影响

不同运行之间没有影响。每个 fixture variant 都在隔离进程和复制的 workspace 中启动，因此评估器不会在样本之间保留模型请求前缀或会话状态。

## 已知限制和延期工作

- **固定目录** — 四个 baseline fixture，以及各三个 medium、difficult 和 stress fixture；stress 组覆盖异步生命周期回滚、持久化崩溃恢复和租户隔离的工具执行。评估器既不生成任务，也不使用模型 judge。
- **未测量的用量保持 `null`** — 当适配器无法提供权威测量时，usage 和 cost 为 `null`，因此这些列并非在所有适配器之间都可比较。
- **A/B 需要两套凭据** — 完整 A/B 结果同时需要供 Codex 使用的 OpenRouter API key 和供 DeepSeek Harness 使用的 OpenRouter OAuth 订阅。
